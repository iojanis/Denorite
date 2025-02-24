// deno-lint-ignore-file no-explicit-any
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { ts } from "https://deno.land/x/ts_morph@21.0.0/mod.ts";

interface CommandMetadata {
  name: string;
  path: string[];
  description: string;
  permission: string;
  arguments: ArgumentMetadata[];
  requires?: string[];
  returns?: string;
}

interface ArgumentMetadata {
  name: string;
  type: string;
  description: string;
  required?: boolean;
}

interface SocketMetadata {
  name: string;
  description: string;
  permission?: string;
  parameters?: Record<string, string>;
  returns: string;
}

interface EventHandlerMetadata {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

interface TypeDefinition {
  name: string;
  definition: string;
}

interface KVPath {
  path: string[];
  description: string;
  module: string;
}

interface ModuleMetadata {
  name: string;
  version: string;
  description?: string;
  commands: CommandMetadata[];
  sockets: SocketMetadata[];
  events: EventHandlerMetadata[];
  kvPaths: KVPath[];
  types: TypeDefinition[];
  constants: Record<string, any>;
}

export class ModuleDocumentGenerator {
  private moduleMetadata: Map<string, ModuleMetadata> = new Map();
  private kvPaths: Set<string> = new Set();
  private typeDefinitions: Map<string, string> = new Map();

  constructor(private basePath: string) {}

  async generateDocumentation(): Promise<string> {
    for await (
      const entry of walk(this.basePath, {
        includeDirs: false,
        match: [/\.ts$/],
        skip: [/node_modules/, /\.git/],
      })
    ) {
      await this.processFile(entry.path);
    }

    return this.formatDocumentation();
  }

  private async processFile(filePath: string): Promise<void> {
    const content = await Deno.readTextFile(filePath);
    const ast = this.parseTypeScript(content);
    if (!ast) return;

    const moduleDecorator = this.findModuleDecorator(ast);
    if (!moduleDecorator) return;

    const metadata: ModuleMetadata = {
      name: moduleDecorator.name,
      version: moduleDecorator.version,
      description: moduleDecorator.description,
      commands: this.extractCommands(ast),
      sockets: this.extractSockets(ast),
      events: this.extractEvents(ast),
      kvPaths: this.extractKVPaths(ast, moduleDecorator.name),
      types: this.extractTypes(ast),
      constants: this.extractConstants(ast),
    };

    this.moduleMetadata.set(moduleDecorator.name, metadata);
  }

  private parseTypeScript(content: string): ts.SourceFile | undefined {
    try {
      return ts.createSourceFile(
        "temp.ts",
        content,
        ts.ScriptTarget.Latest,
        true,
      );
    } catch (error) {
      console.error("Failed to parse TypeScript:", error);
      return undefined;
    }
  }

  private visitNode(node: ts.Node, callback: (node: ts.Node) => void) {
    callback(node);
    ts.forEachChild(node, (child) => this.visitNode(child, callback));
  }

  private getDecorators(node: ts.Node): ts.Decorator[] {
    if (ts.canHaveDecorators(node)) {
      const nodeWithDecorators = node as ts.Node & {
        decorators?: ts.NodeArray<ts.Decorator>;
      };
      return nodeWithDecorators.decorators?.slice() || [];
    }
    return [];
  }

  private extractCommands(ast: ts.SourceFile): CommandMetadata[] {
    const commands: CommandMetadata[] = [];

    this.visitNode(ast, (node) => {
      if (ts.isMethodDeclaration(node)) {
        const decorators = this.getDecorators(node);
        let commandPath: string[] = [];
        let description = "";
        let permission = "player";
        let args: ArgumentMetadata[] = [];
        let requires: string[] = [];

        decorators.forEach((decorator) => {
          if (ts.isCallExpression(decorator.expression)) {
            const decoratorName = decorator.expression.expression.getText();
            const decoratorArgs = this.extractDecoratorArgs(decorator);

            switch (decoratorName) {
              case "Command":
                commandPath = decoratorArgs[0];
                break;
              case "Description":
                description = decoratorArgs[0];
                break;
              case "Permission":
                permission = decoratorArgs[0];
                break;
              case "Argument":
                args = decoratorArgs[0];
                break;
              case "Online":
                requires.push("Online");
                break;
            }
          }
        });

        if (commandPath.length > 0) {
          let returns = "void";
          if (node.type) {
            returns = node.type.getText();
          }

          commands.push({
            name: commandPath[commandPath.length - 1],
            path: commandPath,
            description,
            permission,
            arguments: args,
            requires: requires.length > 0 ? requires : undefined,
            returns,
          });
        }
      }
    });

    return commands;
  }

  private extractSockets(ast: ts.SourceFile): SocketMetadata[] {
    const sockets: SocketMetadata[] = [];

    this.visitNode(ast, (node) => {
      if (ts.isMethodDeclaration(node)) {
        const decorators = this.getDecorators(node);
        let socketName = "";
        let description = "";
        let permission: string | undefined;
        const parameters: Record<string, string> = {};

        decorators.forEach((decorator) => {
          if (ts.isCallExpression(decorator.expression)) {
            const decoratorName = decorator.expression.expression.getText();
            const decoratorArgs = this.extractDecoratorArgs(decorator);

            switch (decoratorName) {
              case "Socket":
                socketName = decoratorArgs[0];
                break;
              case "Description":
                description = decoratorArgs[0];
                break;
              case "Permission":
                permission = decoratorArgs[0];
                break;
            }
          }
        });

        if (socketName) {
          if (node.parameters.length > 0) {
            const param = node.parameters[0];
            if (
              ts.isParameter(param) && param.type &&
              ts.isTypeReferenceNode(param.type)
            ) {
              Object.assign(parameters, this.extractParameterTypes(param.type));
            }
          }

          let returns = "void";
          if (node.type) {
            returns = node.type.getText();
          }

          sockets.push({
            name: socketName,
            description: description || `Socket handler for ${socketName}`,
            permission,
            parameters,
            returns,
          });
        }
      }
    });

    return sockets;
  }

  private extractEvents(ast: ts.SourceFile): EventHandlerMetadata[] {
    const events: EventHandlerMetadata[] = [];

    this.visitNode(ast, (node) => {
      if (ts.isMethodDeclaration(node)) {
        const decorators = this.getDecorators(node);
        let eventName = "";
        let description = "";
        const parameters: Record<string, string> = {};

        decorators.forEach((decorator) => {
          if (ts.isCallExpression(decorator.expression)) {
            const decoratorName = decorator.expression.expression.getText();
            const decoratorArgs = this.extractDecoratorArgs(decorator);

            switch (decoratorName) {
              case "Event":
                eventName = decoratorArgs[0];
                break;
              case "Description":
                description = decoratorArgs[0];
                break;
            }
          }
        });

        if (eventName) {
          if (node.parameters.length > 0) {
            const param = node.parameters[0];
            if (
              ts.isParameter(param) && param.type &&
              ts.isTypeReferenceNode(param.type)
            ) {
              Object.assign(parameters, this.extractParameterTypes(param.type));
            }
          }

          const jsDocDescription = this.extractJSDocComment(node);
          if (jsDocDescription && !description) {
            description = jsDocDescription;
          }

          events.push({
            name: eventName,
            description: description || `Event handler for ${eventName}`,
            parameters,
          });
        }
      }
    });

    return events;
  }

  private extractKVPaths(ast: ts.SourceFile, moduleName: string): KVPath[] {
    const paths: KVPath[] = [];
    const seenPaths = new Set<string>();

    this.visitNode(ast, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.getText();
        const target = node.expression.expression.getText();

        if (
          (target === "kv" || target.endsWith(".kv")) &&
          ["get", "set", "delete", "list"].includes(method)
        ) {
          if (
            node.arguments.length > 0 &&
            ts.isArrayLiteralExpression(node.arguments[0])
          ) {
            const pathElements = node.arguments[0].elements.map((el) =>
              this.evaluateConstant(el.getText())
            );
            const pathString = JSON.stringify(pathElements);

            if (!seenPaths.has(pathString)) {
              seenPaths.add(pathString);

              let description = "";
              const comments = ts.getLeadingCommentRanges(
                ast.getFullText(),
                node.getFullStart(),
              );
              if (comments && comments.length > 0) {
                description = ast.getFullText().slice(
                  comments[0].pos,
                  comments[0].end,
                )
                  .replace(/\/\*|\*\/|\/\/|\*/g, "").trim();
              }

              if (!description) {
                description = this.inferKVDescription(method, pathElements);
              }

              paths.push({
                path: pathElements,
                description,
                module: moduleName,
              });
            }
          }
        }
      }
    });

    return paths;
  }

  private inferKVDescription(method: string, pathElements: string[]): string {
    const lastElement = pathElements[pathElements.length - 1];
    switch (method) {
      case "get":
        return `Retrieves ${lastElement} data`;
      case "set":
        return `Stores ${lastElement} data`;
      case "delete":
        return `Removes ${lastElement} data`;
      case "list":
        return `Lists all ${lastElement} entries`;
      default:
        return `Manages ${lastElement} data`;
    }
  }

  private extractTypes(ast: ts.SourceFile): TypeDefinition[] {
    const types: TypeDefinition[] = [];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

    this.visitNode(ast, (node) => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const name = node.name.getText();
        const jsDoc = this.extractJSDocComment(node);
        const typeText = printer.printNode(ts.EmitHint.Unspecified, node, ast);
        const definition = jsDoc ? `${jsDoc}\n${typeText}` : typeText;

        types.push({ name, definition });
      }
    });

    return types;
  }

  private extractConstants(ast: ts.SourceFile): Record<string, any> {
    const constants: Record<string, any> = {};

    this.visitNode(ast, (node) => {
      if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.length > 0 &&
        node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ConstKeyword)
      ) {
        node.declarationList.declarations.forEach((declaration) => {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            const name = declaration.name.text;
            const value = this.evaluateConstant(
              declaration.initializer.getText(),
            );
            constants[name] = value;
          }
        });
      }

      if (ts.isEnumDeclaration(node)) {
        const enumName = node.name.getText();
        constants[enumName] = {};
        node.members.forEach((member) => {
          if (ts.isIdentifier(member.name)) {
            const memberName = member.name.text;
            const value = member.initializer
              ? this.evaluateConstant(member.initializer.getText())
              : undefined;
            constants[enumName][memberName] = value;
          }
        });
      }
    });

    return constants;
  }

  private extractParameterTypes(
    typeRef: ts.TypeReferenceNode,
  ): Record<string, string> {
    const parameters: Record<string, string> = {};

    if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
      const paramType = typeRef.typeArguments[0];
      if (ts.isTypeLiteralNode(paramType)) {
        paramType.members.forEach((member) => {
          if (
            ts.isPropertySignature(member) && member.type &&
            ts.isIdentifier(member.name)
          ) {
            parameters[member.name.text] = member.type.getText();
          }
        });
      }
    }

    return parameters;
  }

  private extractJSDocComment(node: ts.Node): string | undefined {
    const sourceFile = node.getSourceFile();
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(
      fullText,
      node.getFullStart(),
    );

    if (!commentRanges?.length) return undefined;

    const jsDocComment = commentRanges
      .reverse()
      .find((range) => {
        const comment = fullText.slice(range.pos, range.end);
        return comment.startsWith("/**") && comment.endsWith("*/");
      });

    if (!jsDocComment) return undefined;

    return fullText
      .slice(jsDocComment.pos, jsDocComment.end)
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*\/\*\*/, "")
          .replace(/\*\/$/, "")
          .replace(/^\s*\*\s?/, "")
          .trim()
      )
      .filter((line) => line.length > 0)
      .join("\n");
  }

  private findModuleDecorator(
    ast: ts.SourceFile,
  ): { name: string; version: string; description?: string } | null {
    let moduleDecorator:
      | { name: string; version: string; description?: string }
      | null = null;

    this.visitNode(ast, (node) => {
      if (ts.isClassDeclaration(node)) {
        const decorators = this.getDecorators(node);
        decorators.forEach((decorator) => {
          if (
            ts.isCallExpression(decorator.expression) &&
            ts.isIdentifier(decorator.expression.expression) &&
            decorator.expression.expression.text === "Module"
          ) {
            const args = this.extractDecoratorArgs(decorator);
            if (args.length > 0) {
              moduleDecorator = args[0];
            }
          }
        });
      }
    });

    return moduleDecorator;
  }

  private extractDecoratorArgs(decorator: ts.Decorator): any[] {
    if (ts.isCallExpression(decorator.expression)) {
      return decorator.expression.arguments.map((arg) => {
        if (ts.isObjectLiteralExpression(arg)) {
          const obj: Record<string, any> = {};
          arg.properties.forEach((prop) => {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              const name = prop.name.text;
              const value = this.evaluateConstant(prop.initializer.getText());
              obj[name] = value;
            }
          });
          return obj;
        } else if (ts.isArrayLiteralExpression(arg)) {
          return arg.elements.map((el) => el.getText());
        }
        return this.evaluateConstant(arg.getText());
      });
    }
    return [];
  }

  private evaluateConstant(expr: string): any {
    try {
      return Function(`"use strict"; return (${expr});`)();
    } catch {
      return expr;
    }
  }

  private formatDocumentation(): string {
    let doc = "# Module API Documentation\n\n";

    for (const [_, metadata] of this.moduleMetadata.entries()) {
      doc += this.formatModuleSection(metadata);
    }

    return doc;
  }

  private formatModuleSection(metadata: ModuleMetadata): string {
    let section = `## ${metadata.name} (v${metadata.version})\n\n`;

    if (metadata.description) {
      section += `${metadata.description}\n\n`;
    }

    // Commands section
    if (metadata.commands.length > 0) {
      section += "### Commands\n\n";
      metadata.commands.forEach((cmd) => {
        section += this.formatCommand(cmd);
      });
      section += "\n";
    }

    // Socket events section
    if (metadata.sockets.length > 0) {
      section += "### Socket Events\n\n";
      metadata.sockets.forEach((socket) => {
        section += this.formatSocket(socket);
      });
      section += "\n";
    }

    // Event handlers section
    if (metadata.events.length > 0) {
      section += "### Event Handlers\n\n";
      metadata.events.forEach((event) => {
        section += this.formatEventHandler(event);
      });
      section += "\n";
    }

    // KV paths section
    if (metadata.kvPaths.length > 0) {
      section += "### KV Paths\n\n";
      metadata.kvPaths.forEach((path) => {
        section += `#### \`${JSON.stringify(path.path)}\`\n`;
        section += `- **Description:** ${path.description}\n`;
        section += `- **Module:** ${path.module}\n\n`;
      });
      section += "\n";
    }

    // Types section
    if (metadata.types.length > 0) {
      section += "### Types\n\n```typescript\n";
      metadata.types.forEach((type) => {
        section += `${type.definition}\n\n`;
      });
      section += "```\n\n";
    }

    // Constants section
    if (Object.keys(metadata.constants).length > 0) {
      section += "### Constants\n\n```typescript\n";
      Object.entries(metadata.constants).forEach(([key, value]) => {
        section += `const ${key} = ${JSON.stringify(value, null, 2)};\n`;
      });
      section += "```\n\n";
    }

    return section;
  }

  private formatCommand(cmd: CommandMetadata): string {
    let doc = `#### \`${cmd.path.join(" ")}\`\n\n`;
    doc += `- **Description:** ${cmd.description}\n`;
    doc += `- **Permission:** ${cmd.permission}\n`;

    if (cmd.arguments && cmd.arguments.length > 0) {
      doc += "- **Arguments:**\n";
      cmd.arguments.forEach((arg) => {
        doc += `  - \`${arg.name}\`: ${arg.type}${
          arg.required === false ? " (optional)" : ""
        }\n`;
        doc += `    - ${arg.description}\n`;
      });
    }

    if (cmd.requires && cmd.requires.length > 0) {
      doc += `- **Requires:** ${cmd.requires.join(", ")}\n`;
    }

    if (cmd.returns) {
      doc += `- **Returns:** \`${cmd.returns}\`\n`;
    }

    doc += "\n";
    return doc;
  }

  private formatSocket(socket: SocketMetadata): string {
    let doc = `#### \`${socket.name}\`\n\n`;
    doc += `- **Description:** ${socket.description}\n`;

    if (socket.permission) {
      doc += `- **Permission:** ${socket.permission}\n`;
    }

    if (socket.parameters && Object.keys(socket.parameters).length > 0) {
      doc += "- **Parameters:**\n";
      Object.entries(socket.parameters).forEach(([param, type]) => {
        doc += `  - \`${param}\`: \`${type}\`\n`;
      });
    }

    doc += `- **Returns:** \`${socket.returns}\`\n\n`;
    return doc;
  }

  private formatEventHandler(event: EventHandlerMetadata): string {
    let doc = `#### \`${event.name}\`\n\n`;
    doc += `- **Description:** ${event.description}\n`;

    if (Object.keys(event.parameters).length > 0) {
      doc += "- **Parameters:**\n";
      Object.entries(event.parameters).forEach(([param, type]) => {
        doc += `  - \`${param}\`: \`${type}\`\n`;
      });
    }

    doc += "\n";
    return doc;
  }
}
