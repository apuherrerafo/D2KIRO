import { useState } from "react";
import { Button, type ButtonProps } from "@/design/components";

const meta = {
  title: "Design System/Button",
  component: Button,
};

export default meta;

export function Default(args: ButtonProps) {
  return <Button {...args} />;
}
Default.args = { children: "Lock Recommendation" };

export function Secondary() {
  return <Button variant="secondary">Alternative Pick</Button>;
}

export function Disabled() {
  return <Button disabled>Unavailable Action</Button>;
}

export function Busy() {
  return <Button busy>Computing Suggestions...</Button>;
}

export function FocusVisible() {
  return (
    <div className="p-2">
      <Button autoFocus>Focused Action</Button>
    </div>
  );
}

export function KeyboardActivation() {
  const [count, setCount] = useState(0);

  function handleActivate() {
    setCount((prev) => prev + 1);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleActivate}>Keyboard Target</Button>
      <span aria-live="polite" className="text-caption text-content-secondary">
        Activations: {count}
      </span>
    </div>
  );
}
