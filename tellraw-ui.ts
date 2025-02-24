// Tellraw JSON interface
interface TellrawJSON {
  text?: string;
  translate?: string;
  with?: (string | TellrawJSON)[];
  score?: {
    name: string;
    objective: string;
    value?: string;
  };
  selector?: string;
  keybind?: string;
  nbt?: string;
  interpret?: boolean;
  block?: string;
  entity?: string;
  extra?: TellrawJSON[];
  color?: Color;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  insertion?: string;
  clickEvent?: {
    action: ClickAction;
    value: string;
  };
  hoverEvent?: {
    action: "show_text";
    value: string | string[];
  } | {
    action: "show_item";
    value: {
      id: string;
      count?: number;
      tag?: string;
    };
  } | {
    action: "show_entity";
    value: {
      name?: string;
      type: string;
      id: string;
    };
  };
}

// Core types for the UI system
type Color =
  | "black"
  | "dark_blue"
  | "dark_green"
  | "dark_aqua"
  | "dark_red"
  | "dark_purple"
  | "gold"
  | "gray"
  | "dark_gray"
  | "blue"
  | "green"
  | "aqua"
  | "red"
  | "light_purple"
  | "yellow"
  | "white"
  | `#${string}`;

type Style = "bold" | "italic" | "strikethrough" | "underline" | "obfuscated";
type ClickAction =
  | "run_command"
  | "suggest_command"
  | "copy_to_clipboard"
  | "open_url";
type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"
  | "success";

// Base interfaces
interface UIComponent {
  readonly type: string;
  render(env: Environment): TellrawJSON | string;
}

interface FormField extends UIComponent {
  name: string;
  defaultValue?: any;
  required?: boolean;
  validate?: (value: any) => boolean | string;
}

interface Environment {
  platform: "minecraft" | "web";
  player?: string;
  width?: number;
  height?: number;
}

const DEFAULT_ENV: Environment = {
  platform: "minecraft",
};

interface BaseProps {
  id?: string;
  className?: string;
  style?: Partial<StyleProps>;
  tooltip?: string | TooltipProps;
  onClick?: ClickProps;
}

interface StyleProps {
  color?: Color;
  styles?: Style[];
  gradient?: {
    from: Color;
    to: Color;
  };
  animation?: "pulse" | "wave" | "shake";
}

interface ClickProps {
  action: ClickAction;
  value: string;
}

interface TooltipProps {
  text: string[] | string;
  item?: {
    id: string;
    meta?: Record<string, any>;
  };
}

// Form class fix - proper nested component rendering
class Form implements UIComponent {
  readonly type = "form";

  constructor(
    private fields: FormField[],
    private props: BaseProps & {
      onSubmit: (data: Record<string, any>) => void | Promise<void>;
      validation?: Record<string, (value: any) => boolean>;
      layout?: "vertical" | "horizontal";
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      // Properly render each field with spacing
      const renderedFields = this.fields.map((field) => {
        const rendered = field.render(env);
        // Ensure proper TellrawJSON structure
        if (typeof rendered === "string") {
          return { text: rendered };
        }
        return rendered;
      });

      // Add spacing between fields
      const extra: TellrawJSON[] = [];
      renderedFields.forEach((field, index) => {
        extra.push(field);
        if (index < renderedFields.length - 1) {
          extra.push({ text: "\n" });
        }
      });

      return {
        text: "",
        extra,
      };
    }

    return {
      type: "form",
      fields: this.fields.map((field) => field.render(env)),
      layout: this.props.layout || "vertical",
      handlers: {
        onSubmit: this.props.onSubmit,
      },
    };
  }
}

// RadioGroup fix - proper option rendering
class RadioGroup implements FormField {
  readonly type = "radio-group";

  constructor(
    private options: { label: string; value: string }[],
    private props: BaseProps & {
      name: string;
      defaultValue?: string;
      required?: boolean;
      onChange?: (value: string) => void;
    },
  ) {}

  get name() {
    return this.props.name;
  }
  get defaultValue() {
    return this.props.defaultValue;
  }
  get required() {
    return this.props.required;
  }

  validate(value: any): boolean | string {
    if (this.required && !value) {
      return "This field is required";
    }
    if (value && !this.options.some((opt) => opt.value === value)) {
      return "Invalid option selected";
    }
    return true;
  }

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const extra: TellrawJSON[] = [];

      this.options.forEach((option, index) => {
        const isSelected = option.value === this.defaultValue;

        extra.push({
          text: isSelected ? "● " : "○ ",
          color: isSelected ? "green" : "gray",
          clickEvent: {
            action: "run_command",
            value: `/select ${this.name} ${option.value}`,
          },
        });

        extra.push({
          text: option.label,
          color: isSelected ? "green" : "gray",
          clickEvent: {
            action: "run_command",
            value: `/select ${this.name} ${option.value}`,
          },
        });

        if (index < this.options.length - 1) {
          extra.push({ text: "\n" });
        }
      });

      return {
        text: "",
        extra,
      };
    }

    return {
      type: "radio-group",
      name: this.name,
      options: this.options,
      defaultValue: this.defaultValue,
      required: this.required,
      onChange: this.props.onChange,
    };
  }
}

// CheckboxField fix - proper rendering
class CheckboxField implements FormField {
  readonly type = "checkbox-field";

  constructor(
    public name: string,
    private props: BaseProps & {
      label: string;
      defaultValue?: boolean;
      required?: boolean;
      onChange?: (checked: boolean) => void;
      disabled?: boolean;
    },
  ) {}

  get defaultValue() {
    return this.props.defaultValue;
  }
  get required() {
    return this.props.required;
  }

  validate(value: any): boolean | string {
    if (this.required && !value) {
      return "This field must be checked";
    }
    return true;
  }

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const isChecked = this.defaultValue;
      const isDisabled = this.props.disabled;

      return {
        text: "",
        extra: [
          {
            text: isChecked ? "[✓] " : "[  ] ",
            color: isDisabled ? "gray" : (isChecked ? "green" : "white"),
            clickEvent: isDisabled ? undefined : {
              action: "run_command",
              value: `/toggle ${this.name}`,
            },
          },
          {
            text: this.props.label,
            color: isDisabled ? "gray" : "white",
            clickEvent: isDisabled ? undefined : {
              action: "run_command",
              value: `/toggle ${this.name}`,
            },
          },
        ],
      };
    }

    return {
      type: "checkbox",
      name: this.name,
      label: this.props.label,
      defaultChecked: this.defaultValue,
      required: this.required,
      disabled: this.props.disabled,
      onChange: this.props.onChange,
    };
  }
}

// SwitchField fix - proper rendering
class SwitchField implements FormField {
  readonly type = "switch-field";

  constructor(
    public name: string,
    private props: BaseProps & {
      label: string;
      defaultValue?: boolean;
      required?: boolean;
      onChange?: (checked: boolean) => void;
      disabled?: boolean;
    },
  ) {}

  get defaultValue() {
    return this.props.defaultValue;
  }
  get required() {
    return this.props.required;
  }

  validate(value: any): boolean | string {
    if (this.required && !value) {
      return "This field must be enabled";
    }
    return true;
  }

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const isEnabled = this.defaultValue;
      const isDisabled = this.props.disabled;

      return {
        text: "",
        extra: [
          {
            text: isEnabled ? "(•) " : "( ) ",
            color: isDisabled ? "gray" : (isEnabled ? "green" : "white"),
            clickEvent: isDisabled ? undefined : {
              action: "run_command",
              value: `/toggle ${this.name}`,
            },
          },
          {
            text: this.props.label,
            color: isDisabled ? "gray" : "white",
            clickEvent: isDisabled ? undefined : {
              action: "run_command",
              value: `/toggle ${this.name}`,
            },
          },
        ],
      };
    }

    return {
      type: "switch",
      name: this.name,
      label: this.props.label,
      defaultChecked: this.defaultValue,
      required: this.required,
      disabled: this.props.disabled,
      onChange: this.props.onChange,
    };
  }
}

// Basic UI Component implementations
class Text implements UIComponent {
  readonly type = "text";

  constructor(
    private content: string,
    private props: BaseProps = {},
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { style, tooltip, onClick } = this.props;
    return {
      text: this.content,
      ...(style?.color && { color: style.color }),
      ...(style?.styles?.includes("bold") && { bold: true }),
      ...(style?.styles?.includes("obfuscated") && { obfuscated: true }),
      ...(style?.styles?.includes("italic") && { italic: true }),
      ...(style?.styles?.includes("strikethrough") && { strikethrough: true }),
      ...(style?.styles?.includes("underline") && { underline: true }),
      ...(tooltip && {
        hoverEvent: {
          action: "show_text",
          value: typeof tooltip === "string" ? tooltip : tooltip.text,
        },
      }),
      ...(onClick && {
        clickEvent: {
          action: onClick.action,
          value: onClick.value,
        },
      }),
    };
  }
}

class Alert implements UIComponent {
  readonly type = "alert";

  constructor(
    private content: UIComponent[],
    private props: BaseProps & {
      variant?: "default" | "destructive" | "success";
      title?: string;
      description?: string;
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { variant = "default", title, description } = this.props;
    const colors: Record<string, Color> = {
      default: "blue",
      destructive: "red",
      success: "green",
    };

    if (env.platform === "minecraft") {
      return {
        text: "",
        extra: [
          { text: "[ ", color: colors[variant] },
          { text: title || "", bold: true },
          { text: " ]\n" },
          { text: description || "", color: colors[variant] },
          ...this.content.map((c) => c.render(env)),
        ],
      };
    }

    return {
      type: "alert",
      variant,
      title,
      description,
      content: this.content.map((c) => c.render(env)),
    };
  }
}

class Badge implements UIComponent {
  readonly type = "badge";

  constructor(
    private content: string,
    private props: BaseProps & {
      variant?: "default" | "secondary" | "destructive" | "outline";
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { variant = "default" } = this.props;
    const colors: Record<string, Color> = {
      default: "blue",
      secondary: "gray",
      destructive: "red",
      outline: "white",
    };

    return {
      text: this.content,
      color: colors[variant],
      bold: true,
    };
  }
}

class Button implements UIComponent {
  readonly type = "button";

  constructor(
    private content: string | UIComponent[],
    private props: BaseProps & {
      variant?: ButtonVariant;
      size?: "sm" | "md" | "lg";
      loading?: boolean;
      disabled?: boolean;
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { variant = "default", loading, disabled } = this.props;
    const colors: Record<ButtonVariant, Color> = {
      default: "aqua",
      destructive: "red",
      outline: "yellow",
      secondary: "gold",
      ghost: "white",
      link: "blue",
      success: "green",
    };

    if (env.platform === "minecraft") {
      const prefix = disabled ? "⊘ " : loading ? "⟳ " : "▶ ";

      // Handle content properly based on type
      let contentExtra: TellrawJSON[];
      if (typeof this.content === "string") {
        contentExtra = [{
          text: this.content,
          color: colors[variant],
          bold: !disabled,
          italic: disabled,
        }];
      } else {
        contentExtra = this.content.map((c) => c.render(env) as TellrawJSON);
      }

      return {
        text: prefix,
        extra: contentExtra,
        clickEvent: disabled ? undefined : this.props.onClick,
      };
    }

    return {
      type: "button",
      variant,
      loading,
      disabled,
      content: this.content,
    };
  }
}

class Container implements UIComponent {
  readonly type = "container";

  constructor(
    private children: UIComponent[],
    private props: BaseProps & {
      maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
      padding?: boolean;
      center?: boolean;
    } = {},
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      return {
        text: "",
        extra: this.children.map((child) => child.render(env)),
      };
    }

    return {
      type: "container",
      content: this.children.map((child) => child.render(env)),
      ...this.props,
    };
  }
}

class Grid implements UIComponent {
  readonly type = "grid";

  constructor(
    private children: UIComponent[],
    private props: BaseProps & {
      columns?: number;
      gap?: "sm" | "md" | "lg";
      flow?: "row" | "column";
    } = {},
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const { columns = 2 } = this.props;
      const rows: TellrawJSON[] = [];

      // Convert each row into proper TellrawJSON
      for (let i = 0; i < this.children.length; i += columns) {
        const rowChildren = this.children.slice(i, i + columns);

        // Create row with proper spacing
        const rowExtra: TellrawJSON[] = [];
        rowChildren.forEach((child, idx) => {
          // Add the child
          rowExtra.push(child.render(env) as TellrawJSON);
          // Add spacing between columns except for last column
          if (idx < rowChildren.length - 1) {
            rowExtra.push({ text: "  " });
          }
        });

        // Add row with newline
        rows.push({ text: "", extra: rowExtra });
        if (i + columns < this.children.length) {
          rows.push({ text: "\n" });
        }
      }

      return {
        text: "",
        extra: rows,
      };
    }

    return {
      type: "grid",
      content: this.children.map((child) => child.render(env)),
      ...this.props,
    };
  }
}

class Tabs implements UIComponent {
  readonly type = "tabs";

  constructor(
    private tabs: {
      label: string;
      content: UIComponent[];
    }[],
    private props: BaseProps & {
      defaultValue?: string;
      orientation?: "horizontal" | "vertical";
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const { defaultValue } = this.props;
      const activeTab = this.tabs.find((t) => t.label === defaultValue) ||
        this.tabs[0];

      // Create tab headers
      const tabHeaders: TellrawJSON[] = this.tabs.map((tab, idx) => {
        const isActive = tab.label === activeTab.label;
        const header: TellrawJSON = {
          text: isActive ? `[${tab.label}]` : tab.label,
          color: isActive ? "green" : "gray",
          clickEvent: {
            action: "run_command",
            value: `/tab ${tab.label}`,
          },
        };

        // Add spacing between tabs except for last tab
        if (idx < this.tabs.length - 1) {
          return [header, { text: " " }];
        }
        return [header];
      }).flat();

      // Create content section
      const content = activeTab.content.map((c) =>
        c.render(env) as TellrawJSON
      );

      return {
        text: "",
        extra: [
          ...tabHeaders,
          { text: "\n\n" },
          ...content,
        ],
      };
    }

    return {
      type: "tabs",
      tabs: this.tabs.map((tab) => ({
        label: tab.label,
        content: tab.content.map((c) => c.render(env)),
      })),
      ...this.props,
    };
  }
}

class Divider implements UIComponent {
  readonly type = "divider";

  constructor(
    private props: BaseProps & {
      orientation?: "horizontal" | "vertical";
      variant?: "solid" | "dashed" | "dotted";
    } = {},
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { orientation = "horizontal", variant = "solid" } = this.props;

    if (env.platform === "minecraft") {
      const chars = {
        solid: "━",
        dashed: "─",
        dotted: "・",
      };

      return {
        text: orientation === "horizontal"
          ? "\n" + chars[variant].repeat(20) + "\n"
          : "│",
        color: "gray",
      };
    }

    return {
      type: "divider",
      orientation,
      variant,
    };
  }
}

class TextField implements FormField {
  readonly type = "text-field";

  constructor(
    public name: string,
    private props: BaseProps & {
      placeholder?: string;
      defaultValue?: string;
      required?: boolean;
      multiline?: boolean;
      validate?: (value: string) => boolean | string;
    },
  ) {}

  get defaultValue() {
    return this.props.defaultValue;
  }
  get required() {
    return this.props.required;
  }

  validate(value: any): boolean | string {
    if (this.required && !value) {
      return "This field is required";
    }
    if (this.props.validate) {
      return this.props.validate(value);
    }
    return true;
  }

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      return {
        text: this.props.placeholder || `Enter ${this.name}`,
        color: "gray",
        clickEvent: {
          action: "suggest_command",
          value: this.defaultValue || "",
        },
      };
    }

    return {
      type: "input",
      inputType: this.props.multiline ? "textarea" : "text",
      name: this.name,
      defaultValue: this.defaultValue,
      required: this.required,
      placeholder: this.props.placeholder,
    };
  }
}

class SelectField implements FormField {
  readonly type = "select-field";

  constructor(
    public name: string,
    private options: { label: string; value: string }[],
    private props: BaseProps & {
      placeholder?: string;
      defaultValue?: string;
      required?: boolean;
      onChange?: (value: string) => void;
      disabled?: boolean;
    },
  ) {}

  get defaultValue() {
    return this.props.defaultValue;
  }
  get required() {
    return this.props.required;
  }

  validate(value: any): boolean | string {
    if (this.required && !value) {
      return "This field is required";
    }
    if (value && !this.options.some((opt) => opt.value === value)) {
      return "Invalid option selected";
    }
    return true;
  }

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      const selectedOption = this.options.find((opt) =>
        opt.value === this.defaultValue
      );
      return {
        text: selectedOption?.label || this.props.placeholder ||
          `Select ${this.name}`,
        color: "gray",
        clickEvent: {
          action: "suggest_command",
          value: "/select " + this.name,
        },
      };
    }

    return {
      type: "select",
      name: this.name,
      options: this.options,
      defaultValue: this.defaultValue,
      required: this.required,
      placeholder: this.props.placeholder,
      disabled: this.props.disabled,
      onChange: this.props.onChange,
    };
  }
}

class Tooltip implements UIComponent {
  readonly type = "tooltip";

  constructor(
    private content: UIComponent[],
    private props: BaseProps & {
      trigger: UIComponent;
      side?: "top" | "right" | "bottom" | "left";
      align?: "start" | "center" | "end";
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const triggerComponent = this.props.trigger.render(env);

    if (env.platform === "minecraft") {
      return {
        ...triggerComponent,
        hoverEvent: {
          action: "show_text",
          value: this.content.map((c) => c.render(env)),
        },
      };
    }

    return {
      type: "tooltip",
      trigger: triggerComponent,
      content: this.content.map((c) => c.render(env)),
      side: this.props.side,
      align: this.props.align,
    };
  }
}

class Toast implements UIComponent {
  readonly type = "toast";

  constructor(
    private props: BaseProps & {
      title: string;
      description?: string;
      variant?: "default" | "destructive" | "success";
      duration?: number;
      action?: {
        label: string;
        onClick: () => void;
      };
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { title, description, variant = "default" } = this.props;
    const colors: Record<string, Color> = {
      default: "blue",
      destructive: "red",
      success: "green",
    };

    if (env.platform === "minecraft") {
      return {
        text: "",
        extra: [
          { text: "▶ ", color: colors[variant] },
          { text: title, bold: true },
          description
            ? { text: "\n  " + description, color: colors[variant] }
            : undefined,
        ].filter(Boolean),
      };
    }

    return {
      type: "toast",
      ...this.props,
    };
  }
}

class ScrollArea implements UIComponent {
  readonly type = "scroll-area";

  constructor(
    private children: UIComponent[],
    private props: BaseProps & {
      height?: number;
      orientation?: "vertical" | "horizontal" | "both";
      scrollbar?: "auto" | "always" | "hover" | "never";
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    if (env.platform === "minecraft") {
      return {
        text: "",
        extra: [
          { text: "▲\n", color: "gray" },
          ...this.children.map((child) => child.render(env)),
          { text: "\n▼", color: "gray" },
        ],
      };
    }

    return {
      type: "scroll-area",
      content: this.children.map((child) => child.render(env)),
      ...this.props,
    };
  }
}

// Additional components (Dialog, Progress, Tabs, etc.) implementation...
class Dialog implements UIComponent {
  readonly type = "dialog";

  constructor(
    private content: UIComponent[],
    private props: BaseProps & {
      title: string;
      description?: string;
      trigger?: UIComponent;
      onClose?: () => void;
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON | string {
    const { title, description } = this.props;

    if (env.platform === "minecraft") {
      return [
        "╔════ " + title + " ════╗",
        description ? "║ " + description + " ║" : "",
        "║",
        ...this.content.map((c) => "║ " + c.render(env)),
        "╚════════════════╝",
      ].filter(Boolean).join("\n");
    }

    return {
      type: "dialog",
      title,
      description,
      content: this.content.map((c) => c.render(env)),
    };
  }
}

class Progress implements UIComponent {
  readonly type = "progress";

  constructor(
    private props: BaseProps & {
      value: number;
      max?: number;
      showLabel?: boolean;
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON {
    const { value, max = 100, showLabel } = this.props;
    const percentage = Math.round((value / max) * 100);

    if (env.platform === "minecraft") {
      const bars = Math.round((percentage / 100) * 10);
      return {
        text: "[",
        extra: [
          { text: "█".repeat(bars), color: "green" },
          { text: "░".repeat(10 - bars), color: "gray" },
          { text: "]", color: "white" },
          showLabel ? { text: ` ${percentage}%`, color: "gray" } : undefined,
        ].filter(Boolean),
      };
    }

    return {
      type: "progress",
      value,
      max,
      showLabel,
    };
  }
}

class Sheet implements UIComponent {
  readonly type = "sheet";

  constructor(
    private children: UIComponent[],
    private props: BaseProps & {
      side?: "top" | "right" | "bottom" | "left";
      overlay?: boolean;
    },
  ) {}

  render(env: Environment = DEFAULT_ENV): TellrawJSON | string {
    const { side = "right" } = this.props;

    if (env.platform === "minecraft") {
      const borders = {
        top: ["╹", "═", "╹"],
        right: ["╶", "║", "╴"],
        bottom: ["╻", "═", "╻"],
        left: ["╴", "║", "╶"],
      };

      return [
        borders[side][0].repeat(20),
        ...this.children.map((child) =>
          `${borders[side][1]} ${child.render(env)}`
        ),
        borders[side][2].repeat(20),
      ].join("\n");
    }

    return {
      type: "sheet",
      content: this.children.map((child) => child.render(env)),
      ...this.props,
    };
  }
}

// Factory functions
export function text(content: string, props?: BaseProps): Text {
  return new Text(content, props);
}

export function alert(
  content: UIComponent[],
  props?: BaseProps & {
    variant?: "default" | "destructive" | "success";
    title?: string;
    description?: string;
  },
): Alert {
  return new Alert(content, props || {});
}

export function badge(
  content: string,
  props?: BaseProps & {
    variant?: "default" | "secondary" | "destructive" | "outline";
  },
): Badge {
  return new Badge(content, props || {});
}

export function button(
  content: string | UIComponent[],
  props?: BaseProps & {
    variant?: ButtonVariant;
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    disabled?: boolean;
  },
): Button {
  return new Button(content, props || {});
}

export function container(
  children: UIComponent[],
  props?: BaseProps & {
    maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
    padding?: boolean;
    center?: boolean;
  },
): Container {
  return new Container(children, props);
}

export function grid(
  children: UIComponent[],
  props?: BaseProps & {
    columns?: number;
    gap?: "sm" | "md" | "lg";
    flow?: "row" | "column";
  },
): Grid {
  return new Grid(children, props);
}

export function divider(
  props?: BaseProps & {
    orientation?: "horizontal" | "vertical";
    variant?: "solid" | "dashed" | "dotted";
  },
): Divider {
  return new Divider(props);
}

export function textField(
  name: string,
  props?: BaseProps & {
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    multiline?: boolean;
    validate?: (value: string) => boolean | string;
  },
): TextField {
  return new TextField(name, props || {});
}

export function radioGroup(
  options: { label: string; value: string }[],
  props: BaseProps & {
    name: string;
    defaultValue?: string;
    required?: boolean;
    onChange?: (value: string) => void;
  },
): RadioGroup {
  return new RadioGroup(options, props);
}

export function dialog(
  content: UIComponent[],
  props: BaseProps & {
    title: string;
    description?: string;
    trigger?: UIComponent;
    onClose?: () => void;
  },
): Dialog {
  return new Dialog(content, props);
}

export function progress(
  props: BaseProps & {
    value: number;
    max?: number;
    showLabel?: boolean;
  },
): Progress {
  return new Progress(props);
}

export function tabs(
  tabs: {
    label: string;
    content: UIComponent[];
  }[],
  props?: BaseProps & {
    defaultValue?: string;
    orientation?: "horizontal" | "vertical";
  },
): Tabs {
  return new Tabs(tabs, props || {});
}

export function form(
  fields: FormField[],
  props: BaseProps & {
    onSubmit: (data: Record<string, any>) => void | Promise<void>;
    validation?: Record<string, (value: any) => boolean>;
    layout?: "vertical" | "horizontal";
  },
): Form {
  return new Form(fields, props);
}

export function sheet(
  children: UIComponent[],
  props: BaseProps & {
    side?: "top" | "right" | "bottom" | "left";
    overlay?: boolean;
  },
): Sheet {
  return new Sheet(children, props);
}

export function selectField(
  name: string,
  options: { label: string; value: string }[],
  props?: BaseProps & {
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    onChange?: (value: string) => void;
    disabled?: boolean;
  },
): SelectField {
  return new SelectField(name, options, props || {});
}

export function checkboxField(
  name: string,
  props: BaseProps & {
    label: string;
    defaultValue?: boolean;
    required?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
  },
): CheckboxField {
  return new CheckboxField(name, props);
}

export function switchField(
  name: string,
  props: BaseProps & {
    label: string;
    defaultValue?: boolean;
    required?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
  },
): SwitchField {
  return new SwitchField(name, props);
}

export function tooltip(
  content: UIComponent[],
  props: BaseProps & {
    trigger: UIComponent;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  },
): Tooltip {
  return new Tooltip(content, props);
}

export function toast(
  props: BaseProps & {
    title: string;
    description?: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
    action?: {
      label: string;
      onClick: () => void;
    };
  },
): Toast {
  return new Toast(props);
}

export function scrollArea(
  children: UIComponent[],
  props?: BaseProps & {
    height?: number;
    orientation?: "vertical" | "horizontal" | "both";
    scrollbar?: "auto" | "always" | "hover" | "never";
  },
): ScrollArea {
  return new ScrollArea(children, props || {});
}

// Export types
export type {
  BaseProps,
  ButtonVariant,
  ClickAction,
  ClickProps,
  Color,
  Environment,
  FormField,
  Style,
  StyleProps,
  TellrawJSON,
  TooltipProps,
  UIComponent,
};
