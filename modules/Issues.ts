import {
  Argument,
  Command,
  Description,
  Module,
  Permission,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";

interface Issue {
  id: string;
  number: number;
  title: string;
  description: string;
  author: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  closedBy?: string;
}

interface Comment {
  id: string;
  issueId: string;
  author: string;
  content: string;
  createdAt: string;
}

interface Label {
  name: string;
  color: string;
  description: string;
}

@Module({
  name: "Issues",
  version: "1.0.0",
  description: "GitHub-style issue tracking system",
})
export class Issues {
  private readonly DEFAULT_LABELS: Label[] = [
    { name: "bug", color: "red", description: "Something is not working" },
    {
      name: "enhancement",
      color: "light_purple",
      description: "New feature or request",
    },
    {
      name: "question",
      color: "aqua",
      description: "Further information is requested",
    },
    {
      name: "help wanted",
      color: "green",
      description: "Extra attention is needed",
    },
    { name: "invalid", color: "gray", description: "This issue is invalid" },
    {
      name: "wontfix",
      color: "dark_gray",
      description: "This will not be worked on",
    },
  ];

  private async getNextIssueNumber(kv: any): Promise<number> {
    const countResult = await kv.get(["issues", "count"]);
    const currentCount = countResult.value || 0;
    await kv.set(["issues", "count"], currentCount + 1);
    return currentCount + 1;
  }

  private createId(): string {
    return crypto.randomUUID();
  }

  private async getIssue(kv: any, issueId: string): Promise<Issue | null> {
    const result = await kv.get(["issues", "data", issueId]);
    return result.value;
  }

  private async getIssueByNumber(
    kv: any,
    number: number,
  ): Promise<Issue | null> {
    const issues = await this.getAllIssues(kv);
    return issues.find((issue) => issue.number === number) || null;
  }

  private async getAllIssues(kv: any): Promise<Issue[]> {
    const issues: Issue[] = [];
    const iterator = kv.list({ prefix: ["issues", "data"] });
    for await (const entry of iterator) {
      issues.push(entry.value);
    }
    return issues.sort((a, b) => b.number - a.number);
  }

  private async initializeLabels(kv: any): Promise<void> {
    const labelsResult = await kv.get(["issues", "labels"]);
    if (!labelsResult.value) {
      await kv.set(["issues", "labels"], this.DEFAULT_LABELS);
    }
  }

  @Command(["issues"])
  @Description("Issue tracking commands")
  @Permission("player")
  async issues({
    params,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "=== Issue Commands ===\n", color: "gold", bold: true },
          { text: "/issues create <title>", color: "yellow" },
          { text: " - Create a new issue\n", color: "gray" },
          {
            text: "/issues list",
            color: "yellow",
            clickEvent: {
              action: "run_command",
              value: "/issues list",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to list all issues",
            },
          },
          { text: " - List all issues\n", color: "gray" },
          { text: "/issues view <number>", color: "yellow" },
          { text: " - View issue details\n", color: "gray" },
          { text: "/issues comment <number> <text>", color: "yellow" },
          { text: " - Comment on an issue\n", color: "gray" },
          { text: "/issues close <number>", color: "yellow" },
          { text: " - Close an issue\n", color: "gray" },
          { text: "/issues reopen <number>", color: "yellow" },
          { text: " - Reopen a closed issue\n", color: "gray" },
          { text: "/issues label <number> <label>", color: "yellow" },
          { text: " - Add a label to an issue\n", color: "gray" },
          { text: "/issues assign <number> <player>", color: "yellow" },
          { text: " - Assign a player to an issue\n", color: "gray" },
          { text: "\nOperator Commands:\n", color: "gold" },
          { text: "/issues delete <number>", color: "yellow" },
          { text: " - Delete an issue\n", color: "gray" },
          { text: "/issues addlabel <name> <color>", color: "yellow" },
          { text: " - Create a new label\n", color: "gray" },
          { text: "\n\n", color: "white" },
          {
            text: "[Create Issue]",
            color: "green",
            clickEvent: {
              action: "suggest_command",
              value: "/issues create ",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to create a new issue",
            },
          },
        ]),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["issues", "create"])
  @Description("Create a new issue")
  @Permission("player")
  @Argument([
    { name: "title", type: "string", description: "Issue title" },
    { name: "description", type: "string", description: "Issue description" },
  ])
  async createIssue({ params, kv, tellraw, log }: ScriptContext): Promise<{
    messages: any[];
    success?: boolean;
    issue?: Issue;
  }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const number = await this.getNextIssueNumber(kv);
      const issue: Issue = {
        id: this.createId(),
        number,
        title: args.title,
        description: args.description,
        author: sender,
        state: "open",
        labels: [],
        assignees: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Issue Created Successfully!\n", color: "green", bold: true },
          { text: `#${issue.number}: `, color: "gray" },
          { text: issue.title, color: "yellow" },
          { text: "\n\nActions:\n", color: "gold" },
          {
            text: "[Add Label] ",
            color: "aqua",
            clickEvent: {
              action: "suggest_command",
              value: `/issues label ${issue.number} `,
            },
          },
          {
            text: "[Assign] ",
            color: "light_purple",
            clickEvent: {
              action: "suggest_command",
              value: `/issues assign ${issue.number} `,
            },
          },
          {
            text: "[View]",
            color: "green",
            clickEvent: {
              action: "run_command",
              value: `/issues view ${issue.number}`,
            },
          },
        ]),
      );

      log(`Issue #${number} created by ${sender}: ${args.title}`);
      return { messages, success: true, issue };
    } catch (error) {
      log(`Error creating issue: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["issues", "list"])
  @Description("List all issues")
  @Permission("player")
  @Argument([
    {
      name: "filter",
      type: "string",
      description: "Filter issues (open/closed/all)",
      required: false,
    },
  ])
  async listIssues({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; issues?: Issue[] }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issues = await this.getAllIssues(kv);
      const filter = args.filter?.toLowerCase() || "open";

      const filteredIssues = filter === "all"
        ? issues
        : issues.filter((issue) => issue.state === filter);

      if (filteredIssues.length === 0) {
        messages = await tellraw(
          sender,
          JSON.stringify({
            text: `No ${filter} issues found`,
            color: "yellow",
          }),
        );
        return { messages, issues: [] };
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          {
            text: `=== ${filter.toUpperCase()} Issues ===\n`,
            color: "gold",
            bold: true,
          },
          { text: "Filter: ", color: "gray" },
          {
            text: "[Open] ",
            color: filter === "open" ? "green" : "gray",
            clickEvent: {
              action: "run_command",
              value: "/issues list open",
            },
          },
          {
            text: "[Closed] ",
            color: filter === "closed" ? "red" : "gray",
            clickEvent: {
              action: "run_command",
              value: "/issues list closed",
            },
          },
          {
            text: "[All]\n\n",
            color: filter === "all" ? "yellow" : "gray",
            clickEvent: {
              action: "run_command",
              value: "/issues list all",
            },
          },
        ]),
      );

      for (const issue of filteredIssues) {
        messages = await tellraw(
          sender,
          JSON.stringify([
            { text: `#${issue.number} `, color: "gray" },
            {
              text: issue.title,
              color: issue.state === "open" ? "green" : "red",
              clickEvent: {
                action: "run_command",
                value: `/issues view ${issue.number}`,
              },
              hoverEvent: {
                action: "show_text",
                value: "Click to view issue",
              },
            },
            { text: ` by ${issue.author}`, color: "gray" },
            issue.labels.length > 0
              ? [
                { text: " [", color: "white" },
                ...issue.labels.map((label) => ({
                  text: label + " ",
                  color: "aqua",
                })),
                { text: "]", color: "white" },
              ]
              : [],
            { text: "\n" },
          ]),
        );
      }

      log(`Issues list viewed by ${sender} (filter: ${filter})`);
      return { messages, issues: filteredIssues };
    } catch (error) {
      log(`Error listing issues: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["issues", "view"])
  @Description("View issue details")
  @Permission("player")
  @Argument([{ name: "number", type: "integer", description: "Issue number" }])
  async viewIssue({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[]; issue?: Issue }> {
    const { sender, args } = params;

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      // Get comments
      const comments: Comment[] = [];
      const commentIterator = kv.list({
        prefix: ["issues", "comments", issue.id],
      });
      for await (const entry of commentIterator) {
        comments.push(entry.value);
      }

      // Sort comments by creation date
      comments.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      const header = container([
        divider(),
        text(`Issue #${issue.number}: `, { style: { color: "gray" } }),
        text(issue.title + "\n", {
          style: { color: "yellow", styles: ["bold"] },
        }),

        text("State: ", { style: { color: "gray" } }),
        text(issue.state.toUpperCase() + "\n", {
          style: {
            color: issue.state === "open" ? "green" : "red",
            styles: ["bold"],
          },
        }),

        text("Created by ", { style: { color: "gray" } }),
        text(issue.author, { style: { color: "green" } }),
        text(` on ${new Date(issue.createdAt).toLocaleString()}\n`, {
          style: { color: "gray" },
        }),

        ...(issue.closedAt
          ? [
            text("Closed by ", { style: { color: "gray" } }),
            text(issue.closedBy, { style: { color: "red" } }),
            text(` on ${new Date(issue.closedAt).toLocaleString()}\n`, {
              style: { color: "gray" },
            }),
          ]
          : []),

        text("\nDescription:\n", { style: { color: "gold" } }),
        text(issue.description + "\n\n", { style: { color: "white" } }),

        // Labels section
        text("Labels: ", { style: { color: "gray" } }),
        ...(issue.labels.length
          ? issue.labels.map((label) =>
            button(`[${label}] `, {
              variant: "ghost",
              onClick: {
                action: "run_command",
                value: `/issues label ${issue.number} ${label}`,
              },
            })
          )
          : [text("None", { style: { color: "gray" } })]),
        text("\n"),

        // Assignees section
        text("Assignees: ", { style: { color: "gray" } }),
        ...(issue.assignees.length
          ? issue.assignees.map((assignee) =>
            button(`@${assignee} `, {
              variant: "ghost",
              onClick: {
                action: "suggest_command",
                value: `/msg ${assignee} About issue #${issue.number}: `,
              },
            })
          )
          : [text("None", { style: { color: "gray" } })]),
        text("\n\n"),

        // Action buttons
        text("Actions: ", { style: { color: "gold" } }),
        ...(issue.state === "open"
          ? [
            button("[Close Issue] ", {
              variant: "destructive",
              onClick: {
                action: "run_command",
                value: `/issues close ${issue.number}`,
              },
            }),
          ]
          : [
            button("[Reopen Issue] ", {
              variant: "success",
              onClick: {
                action: "run_command",
                value: `/issues reopen ${issue.number}`,
              },
            }),
          ]),
        button("[Add Comment] ", {
          variant: "default",
          onClick: {
            action: "suggest_command",
            value: `/issues comment ${issue.number} `,
          },
        }),
        button("[Assign] ", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/issues assign ${issue.number} `,
          },
        }),
        divider(),
      ]);

      let messages = await tellraw(
        sender,
        header.render({ platform: "minecraft", player: sender }),
      );

      // Display comments
      if (comments.length > 0) {
        const commentsTitle = text("Comments:\n", {
          style: { color: "gold", styles: ["bold"] },
        });
        messages = await tellraw(
          sender,
          commentsTitle.render({ platform: "minecraft", player: sender }),
        );

        for (const comment of comments) {
          const commentContent = container([
            text(comment.author, { style: { color: "green" } }),
            text(
              ` commented on ${new Date(comment.createdAt).toLocaleString()}\n`,
              { style: { color: "gray" } },
            ),
            text(comment.content + "\n", { style: { color: "white" } }),
            divider({ variant: "dotted" }),
          ]);
          messages = await tellraw(
            sender,
            commentContent.render({ platform: "minecraft", player: sender }),
          );
        }
      } else {
        const noComments = text("No comments yet.\n", {
          style: { color: "gray", styles: ["italic"] },
        });
        messages = await tellraw(
          sender,
          noComments.render({ platform: "minecraft", player: sender }),
        );
      }

      // Add quick reply button
      const quickReply = button("[Add Comment]", {
        variant: "success",
        onClick: {
          action: "suggest_command",
          value: `/issues comment ${issue.number} `,
        },
      });
      messages = await tellraw(
        sender,
        quickReply.render({ platform: "minecraft", player: sender }),
      );

      return { messages, issue };
    } catch (error) {
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["issues", "comment"])
  @Description("Add a comment to an issue")
  @Permission("player")
  @Argument([
    { name: "number", type: "integer", description: "Issue number" },
    { name: "content", type: "string", description: "Comment content" },
  ])
  async addComment({ params, kv, tellraw, log }: ScriptContext): Promise<{
    messages: any[];
    success?: boolean;
    comment?: Comment;
  }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      const comment: Comment = {
        id: this.createId(),
        issueId: issue.id,
        author: sender,
        content: args.content,
        createdAt: new Date().toISOString(),
      };

      await kv.set(["issues", "comments", issue.id, comment.id], comment);

      // Update issue's updated timestamp
      issue.updatedAt = new Date().toISOString();
      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Comment Added Successfully!\n", color: "green", bold: true },
          { text: `On issue #${issue.number}: `, color: "gray" },
          { text: issue.title + "\n", color: "yellow" },
          { text: "\nYour comment:\n", color: "gray" },
          { text: args.content, color: "white" },
        ]),
      );

      // Notify issue author and assignees
      const notifyUsers = new Set([issue.author, ...issue.assignees]);
      notifyUsers.delete(sender);

      for (const user of notifyUsers) {
        await tellraw(
          user,
          JSON.stringify([
            { text: `New comment on issue #${issue.number}\n`, color: "gold" },
            { text: sender, color: "green" },
            { text: " commented on ", color: "gray" },
            {
              text: issue.title,
              color: "yellow",
              clickEvent: {
                action: "run_command",
                value: `/issues view ${issue.number}`,
              },
            },
          ]),
        );
      }

      log(`Comment added to issue #${args.number} by ${sender}`);
      return { messages, success: true, comment };
    } catch (error) {
      log(`Error adding comment: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["issues", "label"])
  @Description("Add a label to an issue")
  @Permission("player")
  @Argument([
    { name: "number", type: "integer", description: "Issue number" },
    { name: "label", type: "string", description: "Label to add" },
  ])
  async addLabel({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      const labelsResult = await kv.get(["issues", "labels"]);
      const availableLabels: Label[] = labelsResult.value ||
        this.DEFAULT_LABELS;
      const label = availableLabels.find(
        (l) => l.name.toLowerCase() === args.label.toLowerCase(),
      );

      if (!label) {
        const validLabels = availableLabels.map((l) => l.name).join(", ");
        throw new Error(`Invalid label. Available labels: ${validLabels}`);
      }

      if (issue.labels.includes(label.name)) {
        throw new Error(`Issue already has the label "${label.name}"`);
      }

      issue.labels.push(label.name);
      issue.updatedAt = new Date().toISOString();
      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Label Added Successfully!\n", color: "green", bold: true },
          { text: `Added `, color: "gray" },
          { text: label.name, color: label.color },
          { text: ` to issue #${issue.number}\n`, color: "gray" },
          { text: label.description, color: "white", italic: true },
        ]),
      );

      log(`Label "${label.name}" added to issue #${args.number} by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error adding label: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["issues", "assign"])
  @Description("Assign a player to an issue")
  @Permission("player")
  @Argument([
    { name: "number", type: "integer", description: "Issue number" },
    { name: "player", type: "player", description: "Player to assign" },
  ])
  async assignIssue({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      if (issue.assignees.includes(args.player)) {
        throw new Error(`${args.player} is already assigned to this issue`);
      }

      issue.assignees.push(args.player);
      issue.updatedAt = new Date().toISOString();
      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          {
            text: "Assignee Added Successfully!\n",
            color: "green",
            bold: true,
          },
          { text: args.player, color: "light_purple" },
          { text: ` assigned to issue #${issue.number}`, color: "gray" },
        ]),
      );

      // Notify assigned player
      await tellraw(
        args.player,
        JSON.stringify([
          { text: "Issue Assignment\n", color: "gold", bold: true },
          { text: "You've been assigned to ", color: "gray" },
          {
            text: `issue #${issue.number}: ${issue.title}`,
            color: "yellow",
            clickEvent: {
              action: "run_command",
              value: `/issues view ${issue.number}`,
            },
          },
          { text: `\nby ${sender}`, color: "gray" },
        ]),
      );

      log(`${args.player} assigned to issue #${args.number} by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error assigning issue: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["issues", "close"])
  @Description("Close an issue")
  @Permission("player")
  @Argument([{ name: "number", type: "integer", description: "Issue number" }])
  async closeIssue({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      if (issue.state === "closed") {
        throw new Error("Issue is already closed");
      }

      if (issue.author !== sender && !issue.assignees.includes(sender)) {
        throw new Error(
          "Only the issue author or assignees can close this issue",
        );
      }

      issue.state = "closed";
      issue.closedAt = new Date().toISOString();
      issue.closedBy = sender;
      issue.updatedAt = new Date().toISOString();
      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Issue Closed Successfully!\n", color: "green", bold: true },
          { text: `Issue #${issue.number}: `, color: "gray" },
          { text: issue.title, color: "yellow" },
          { text: " has been closed", color: "gray" },
        ]),
      );

      // Notify author and assignees
      const notifyUsers = new Set([issue.author, ...issue.assignees]);
      notifyUsers.delete(sender);

      for (const user of notifyUsers) {
        await tellraw(
          user,
          JSON.stringify([
            { text: `Issue #${issue.number} Closed\n`, color: "gold" },
            { text: sender, color: "green" },
            { text: " closed ", color: "gray" },
            {
              text: issue.title,
              color: "yellow",
              clickEvent: {
                action: "run_command",
                value: `/issues view ${issue.number}`,
              },
            },
          ]),
        );
      }

      log(`Issue #${args.number} closed by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error closing issue: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["issues", "reopen"])
  @Description("Reopen a closed issue")
  @Permission("player")
  @Argument([{ name: "number", type: "integer", description: "Issue number" }])
  async reopenIssue({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const issue = await this.getIssue(kv, args.number);
      if (!issue) {
        throw new Error(`Issue #${args.number} not found`);
      }

      if (issue.state === "open") {
        throw new Error("Issue is already open");
      }

      if (issue.author !== sender && !issue.assignees.includes(sender)) {
        throw new Error(
          "Only the issue author or assignees can reopen this issue",
        );
      }

      issue.state = "open";
      issue.closedAt = undefined;
      issue.closedBy = undefined;
      issue.updatedAt = new Date().toISOString();
      await kv.set(["issues", "data", issue.id], issue);

      messages = await tellraw(
        sender,
        JSON.stringify([
          {
            text: "Issue Reopened Successfully!\n",
            color: "green",
            bold: true,
          },
          { text: `Issue #${issue.number}: `, color: "gray" },
          { text: issue.title, color: "yellow" },
          { text: " has been reopened", color: "gray" },
        ]),
      );

      // Notify author and assignees
      const notifyUsers = new Set([issue.author, ...issue.assignees]);
      notifyUsers.delete(sender);

      for (const user of notifyUsers) {
        await tellraw(
          user,
          JSON.stringify([
            { text: `Issue #${issue.number} Reopened\n`, color: "gold" },
            { text: sender, color: "green" },
            { text: " reopened ", color: "gray" },
            {
              text: issue.title,
              color: "yellow",
              clickEvent: {
                action: "run_command",
                value: `/issues view ${issue.number}`,
              },
            },
          ]),
        );
      }

      log(`Issue #${args.number} reopened by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error reopening issue: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }
}
