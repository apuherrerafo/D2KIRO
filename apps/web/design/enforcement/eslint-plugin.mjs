function insideJsxAttribute(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXAttribute") return true;
    if (current.type === "Program" || current.type.endsWith("Statement")) return false;
    current = current.parent;
  }
  return false;
}

function jsxStringRule({ id, pattern, message }) {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: { [id]: message },
    },
    create(context) {
      return {
        Literal(node) {
          if (typeof node.value !== "string" || !insideJsxAttribute(node)) return;
          if (pattern.test(node.value)) {
            context.report({ node, messageId: id });
          }
        },
      };
    },
  };
}

export const rules = {
  "no-raw-hex": jsxStringRule({
    id: "rawHex",
    pattern: /#[0-9a-f]{3,8}\b/i,
    message:
      "PROBLEM: Raw color value found in JSX attribute.\nWHY: Raw colors bypass semantic roles and break theming/contrast contracts.\nWHAT TO USE INSTEAD: Use semantic tokens (e.g. text-content-primary, bg-surface-raised, bg-accent-primary, var(--content-primary)).",
  }),
  "no-arbitrary-tailwind": jsxStringRule({
    id: "arbitraryTailwind",
    pattern: /(?:^|\s)(?:p|px|py|m|mx|my|gap|rounded|shadow|text|bg|border)-\[[^\]]+\]/,
    message:
      "PROBLEM: Arbitrary Tailwind bracket utility used.\nWHY: Arbitrary bracket utilities break the shared 4px scale, defined radii, and semantic palette.\nWHAT TO USE INSTEAD: Use defined scale utilities (e.g. p-4, px-2, rounded-control, text-caption, bg-accent-primary).",
  }),
  "no-primitive-token": jsxStringRule({
    id: "primitiveToken",
    pattern: /var\(--primitive-/,
    message:
      "PROBLEM: Direct consumption of --primitive-* token in component code.\nWHY: Components must depend on semantic roles, not physical primitive constants.\nWHAT TO USE INSTEAD: Use semantic tokens (e.g. var(--surface-base), var(--accent-primary), var(--radius-control)).",
  }),
  "no-native-button": {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        nativeButton:
          "PROBLEM: Native <button> element used directly.\nWHY: Native buttons lack uniform accessible name models, focus-visible outlines, and busy semantics.\nWHAT TO USE INSTEAD: Import and use { Button } from '@/design/components'.",
      },
    },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name.type === "JSXIdentifier" && node.name.name === "button") {
            const filename = (context.filename || context.getFilename?.() || "").replace(/\\/g, "/");
            if (filename.endsWith("Button.tsx") || filename.endsWith("Button.stories.tsx")) {
              return;
            }
            context.report({ node, messageId: "nativeButton" });
          }
        },
      };
    },
  },
  "no-duplicate-button": {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        duplicateButton:
          "PROBLEM: Component reimplements a custom button primitive.\nWHY: Creating competing button primitives fragments the design system and duplicates accessible behavior.\nWHAT TO USE INSTEAD: Extend or compose { Button } from '@/design/components'.",
      },
    },
    create(context) {
      const source = context.sourceCode;
      return {
        FunctionDeclaration(node) {
          if (!node.id?.name.endsWith("Button")) return;
          const filename = (context.filename || context.getFilename?.() || "").replace(/\\/g, "/");
          if (filename.endsWith("Button.tsx") || filename.endsWith("Button.stories.tsx")) return;
          if (source.getText(node).includes("<button")) {
            context.report({ node: node.id, messageId: "duplicateButton" });
          }
        },
      };
    },
  },
};

const designPlugin = {
  rules,
};

export default designPlugin;
