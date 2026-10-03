import { readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import ts from "typescript";

export interface CatalogProp {
  description: string;
  name: string;
  required: boolean;
  type: string;
}

export interface CatalogComponent {
  accessibilityNotes: string[];
  canonicalUsage: string;
  importPath: string;
  name: string;
  props: CatalogProp[];
  requiredProps: string[];
  states: string[];
  variants: string[];
  purpose: string;
}

export interface ComponentCatalog {
  components: CatalogComponent[];
  generatedAt?: string;
  generatedFrom: string[];
  schemaVersion: 1;
}

const DESIGN_DIR = join(import.meta.dir, "..");
const COMPONENT_DIR = join(DESIGN_DIR, "components");
const STORY_DIR = join(DESIGN_DIR, "stories");

function readTag(block: string, tag: string): string[] {
  const pattern = new RegExp(`@${tag}\\s+([^\\n*]+)`, "g");
  return [...block.matchAll(pattern)].map((match) => match[1].trim());
}

function componentDoc(source: string, componentName: string) {
  const escapedName = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/\\*\\*([\\s\\S]*?)\\*/\\s*export function ${escapedName}`);
  const block = source.match(pattern)?.[1] ?? "";
  return {
    accessibilityNotes: readTag(block, "a11y"),
    canonicalUsage: readTag(block, "canonical")[0] ?? "",
    purpose: readTag(block, "purpose")[0] ?? "",
  };
}

function storyNames(source: string): string[] {
  const file = ts.createSourceFile("story.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    }
  }
  return names;
}

function unionLiterals(type: ts.Type): string[] {
  if (!type.isUnion()) return [];
  return type.types
    .filter((part): part is ts.StringLiteralType => part.isStringLiteral())
    .map((part) => part.value)
    .sort();
}

export async function generateCatalog(options: { write: boolean }): Promise<ComponentCatalog> {
  const componentFiles = ["Button.tsx", "StatusNotice.tsx"].map((name) => join(COMPONENT_DIR, name));
  const program = ts.createProgram(componentFiles, {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const components: CatalogComponent[] = [];

  for (const filePath of componentFiles) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`Missing component source file: ${filePath}`);

    const componentName = basename(filePath, ".tsx");
    const propsInterfaceName = `${componentName}Props`;
    const propsNode = sourceFile.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === propsInterfaceName,
    );
    if (!propsNode) throw new Error(`Missing props interface: ${propsInterfaceName}`);

    const propsType = checker.getTypeAtLocation(propsNode);
    const props: CatalogProp[] = checker
      .getPropertiesOfType(propsType)
      .map((symbol) => {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (!declaration) throw new Error(`Missing declaration for property ${symbol.name}`);
        const propType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
        const required = (symbol.flags & ts.SymbolFlags.Optional) === 0;
        return {
          description: ts.displayPartsToString(symbol.getDocumentationComment(checker)),
          name: symbol.name,
          required,
          type: checker.typeToString(propType),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const requiredProps = props.filter((p) => p.required).map((p) => p.name);

    const variantProp = checker.getPropertyOfType(propsType, "variant");
    let variants: string[] = [];
    if (variantProp) {
      const declaration = variantProp.valueDeclaration ?? variantProp.declarations?.[0];
      if (declaration) {
        variants = unionLiterals(checker.getTypeOfSymbolAtLocation(variantProp, declaration));
      }
    }

    const source = sourceFile.getFullText();
    const doc = componentDoc(source, componentName);
    const storyPath = join(STORY_DIR, `${componentName}.stories.tsx`);
    const stories = storyNames(await readFile(storyPath, "utf8"));

    components.push({
      accessibilityNotes: doc.accessibilityNotes,
      canonicalUsage: doc.canonicalUsage,
      importPath: "@/design/components",
      name: componentName,
      props,
      purpose: doc.purpose,
      requiredProps,
      states: stories.filter((name) => name !== "Default"),
      variants,
    });
  }

  const generatedFrom = componentFiles
    .concat(components.map((c) => join(STORY_DIR, `${c.name}.stories.tsx`)))
    .map((path) => relative(DESIGN_DIR, path).replaceAll("\\", "/"));

  const catalog: ComponentCatalog = {
    components,
    generatedFrom,
    schemaVersion: 1,
  };

  if (options.write) {
    const jsonPath = join(DESIGN_DIR, "COMPONENTS.generated.json");
    await writeFile(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    // Optional llms.txt projection derived strictly from the canonical JSON
    const lines = [
      "# D2KIRO Design System — Component Catalog",
      "",
      "This file is a machine projection derived from COMPONENTS.generated.json.",
      "Do NOT edit directly. Derive mechanically from TypeScript component contracts.",
      "",
    ];

    for (const component of components) {
      lines.push(`## ${component.name}`);
      lines.push(`Purpose: ${component.purpose}`);
      lines.push(`Import: import { ${component.name} } from "${component.importPath}";`);
      lines.push(`Canonical Usage: ${component.canonicalUsage}`);
      lines.push(
        `Props: ${component.props.map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`).join("; ")}`,
      );
      if (component.variants.length > 0) {
        lines.push(`Variants: ${component.variants.join(", ")}`);
      }
      lines.push(`States: ${component.states.join(", ")}`);
      if (component.accessibilityNotes.length > 0) {
        lines.push(`Accessibility: ${component.accessibilityNotes.join(" ")}`);
      }
      lines.push("");
    }

    const llmsPath = join(DESIGN_DIR, "COMPONENTS.llms.txt");
    await writeFile(llmsPath, `${lines.join("\n")}\n`, "utf8");
  }

  return catalog;
}

if (import.meta.main) {
  await generateCatalog({ write: true });
  console.log("Successfully generated COMPONENTS.generated.json and COMPONENTS.llms.txt");
}
