import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

interface Vote {
  id: string;
  title: string;
  description: string;
  author: string;
  createdAt: string;
  expiresAt: string;
  options: VoteOption[];
  voters: Set<string>;
  status: "active" | "passed" | "failed" | "cancelled";
  requiredVotes?: number;
  minYesPercentage?: number;
}

interface VoteOption {
  id: string;
  text: string;
  votes: number;
  voters: Set<string>;
}

@Module({
  name: "Council",
  version: "1.0.0",
  description: "Democratic voting system for server rules and changes",
})
export class Council {
  private readonly VOTE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
  private readonly MIN_DESCRIPTION_LENGTH = 50;
  private readonly MAX_OPTIONS = 5;
  private readonly PROGRESS_BAR_LENGTH = 20;

  private createId(): string {
    return crypto.randomUUID();
  }

  private async getVote(kv: any, voteId: string): Promise<Vote | null> {
    const result = await kv.get(["council", "votes", voteId]);
    return result.value;
  }

  private async getAllVotes(kv: any): Promise<Vote[]> {
    const votes: Vote[] = [];
    const iterator = kv.list({ prefix: ["council", "votes"] });
    for await (const entry of iterator) {
      votes.push(entry.value);
    }
    return votes.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  private renderProgressBar(
    votes: number,
    total: number,
    length: number = this.PROGRESS_BAR_LENGTH,
  ): string {
    if (total === 0) return "░".repeat(length);

    const filledCount = Math.round((votes / total) * length);
    const emptyCount = length - filledCount;
    return "█".repeat(filledCount) + "░".repeat(emptyCount);
  }

  private getProgressBarColor(
    votes: number,
    total: number,
    minPercentage?: number,
  ): string {
    if (total === 0) return "gray";
    const percentage = (votes / total) * 100;

    if (minPercentage) {
      if (percentage >= minPercentage) return "green";
      if (percentage >= minPercentage * 0.75) return "yellow";
      return "red";
    }

    if (percentage >= 66) return "green";
    if (percentage >= 33) return "yellow";
    return "red";
  }

  private getTimeRemaining(expiresAt: string): string {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return "Expired";

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor(
      (remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
    );
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  @Command(["council"])
  @Description("Council voting commands")
  @Permission("player")
  async council(
    { params, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "=== Council Commands ===\n", color: "gold", bold: true },

          { text: "/council propose <title>", color: "yellow" },
          { text: " - Propose a new vote\n", color: "gray" },

          {
            text: "/council list",
            color: "yellow",
            clickEvent: {
              action: "run_command",
              value: "/council list",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to list active votes",
            },
          },
          { text: " - List active votes\n", color: "gray" },

          { text: "/council view <id>", color: "yellow" },
          { text: " - View vote details\n", color: "gray" },

          { text: "/council vote <id> <option>", color: "yellow" },
          { text: " - Cast your vote\n", color: "gray" },

          { text: "/council history", color: "yellow" },
          { text: " - View past votes\n", color: "gray" },

          { text: "\nOperator Commands:\n", color: "gold" },
          { text: "/council cancel <id>", color: "yellow" },
          { text: " - Cancel an active vote\n", color: "gray" },

          { text: "\n\n", color: "white" },
          {
            text: "[Active Votes]",
            color: "green",
            clickEvent: {
              action: "run_command",
              value: "/council list",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to view active votes",
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

  @Command(["council", "propose"])
  @Description("Propose a new vote")
  @Permission("player")
  @Argument([
    { name: "title", type: "string", description: "Vote title" },
  ])
  async proposeVote(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean; vote?: Vote }> {
    const { sender, args } = params;
    let messages = [];

    try {
      // Enter proposal creation mode
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Vote Proposal Creation\n", color: "gold", bold: true },
          { text: "Title: ", color: "gray" },
          { text: args.title + "\n\n", color: "yellow" },
          {
            text:
              "Please provide a detailed description (at least 50 characters)\n",
            color: "gray",
          },
          { text: "Type your description in chat. Start with ", color: "gray" },
          { text: "desc:", color: "yellow", bold: true },
          { text: " followed by your description.\n\n", color: "gray" },
          { text: "Example: ", color: "gray" },
          {
            text: "desc: This proposal aims to...\n",
            color: "yellow",
            italic: true,
          },
        ]),
      );

      // Store pending proposal in temporary storage
      await kv.set(["council", "pending", sender], {
        title: args.title,
        step: "description",
      });

      log(`Vote proposal started by ${sender}: ${args.title}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error creating vote proposal: ${error.message}`);
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

  @Event("player_chat")
  async handleProposalChat(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { playerName: sender, message } = params;
    let messages = [];

    try {
      // Check if player is in proposal creation mode
      const pendingResult = await kv.get(["council", "pending", sender]);
      const pending = pendingResult.value;
      if (!pending) return { messages };

      if (pending.step === "description" && message.startsWith("desc:")) {
        const description = message.substring(5).trim();
        if (description.length < this.MIN_DESCRIPTION_LENGTH) {
          messages = await tellraw(
            sender,
            JSON.stringify({
              text:
                `Description too short. Minimum ${this.MIN_DESCRIPTION_LENGTH} characters.`,
              color: "red",
            }),
          );
          return { messages };
        }

        // Update pending proposal
        pending.description = description;
        pending.step = "options";
        await kv.set(["council", "pending", sender], pending);

        // Prompt for options
        messages = await tellraw(
          sender,
          JSON.stringify([
            { text: "Description saved!\n\n", color: "green" },
            {
              text:
                "Now add voting options. Type each option in chat starting with ",
              color: "gray",
            },
            { text: "option:", color: "yellow", bold: true },
            { text: " (2-5 options required)\n\n", color: "gray" },
            { text: "Example: ", color: "gray" },
            {
              text: "option: Yes, implement this change\n",
              color: "yellow",
              italic: true,
            },
            { text: "\nWhen done, type ", color: "gray" },
            { text: "done", color: "green", bold: true },
            { text: " to finish.\n", color: "gray" },
            { text: "Or type ", color: "gray" },
            { text: "cancel", color: "red", bold: true },
            { text: " to abort.", color: "gray" },
          ]),
        );

        pending.options = [];
        await kv.set(["council", "pending", sender], pending);
      } else if (pending.step === "options") {
        if (message.toLowerCase() === "done") {
          if (!pending.options || pending.options.length < 2) {
            messages = await tellraw(
              sender,
              JSON.stringify({
                text: "At least 2 options are required.",
                color: "red",
              }),
            );
            return { messages };
          }

          // Create the vote
          const vote: Vote = {
            id: this.createId(),
            title: pending.title,
            description: pending.description,
            author: sender,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + this.VOTE_DURATION).toISOString(),
            options: pending.options.map((opt) => ({
              id: this.createId(),
              text: opt,
              votes: 0,
              voters: new Set(),
            })),
            voters: new Set(),
            status: "active",
          };

          await kv.set(["council", "votes", vote.id], vote);
          await kv.delete(["council", "pending", sender]);

          // Announce new vote
          messages = await tellraw(
            "@a",
            JSON.stringify([
              { text: "📢 New Council Vote 📢\n", color: "gold", bold: true },
              { text: vote.title + "\n", color: "yellow" },
              { text: "Proposed by: ", color: "gray" },
              { text: sender + "\n\n", color: "green" },
              {
                text: "[View Details]",
                color: "aqua",
                clickEvent: {
                  action: "run_command",
                  value: `/council view ${vote.id}`,
                },
                hoverEvent: {
                  action: "show_text",
                  value: "Click to view vote details",
                },
              },
            ]),
          );

          log(`New vote created by ${sender}: ${vote.title}`);
        } else if (message.toLowerCase() === "cancel") {
          await kv.delete(["council", "pending", sender]);
          messages = await tellraw(
            sender,
            JSON.stringify({
              text: "Vote proposal cancelled.",
              color: "yellow",
            }),
          );
        } else if (message.startsWith("option:")) {
          const option = message.substring(7).trim();
          if (pending.options.length >= this.MAX_OPTIONS) {
            messages = await tellraw(
              sender,
              JSON.stringify({
                text: `Maximum ${this.MAX_OPTIONS} options allowed.`,
                color: "red",
              }),
            );
            return { messages };
          }

          pending.options.push(option);
          await kv.set(["council", "pending", sender], pending);

          messages = await tellraw(
            sender,
            JSON.stringify([
              { text: "Option added: ", color: "gray" },
              { text: option + "\n", color: "yellow" },
              {
                text: `${pending.options.length}/${this.MAX_OPTIONS} options`,
                color: "gray",
              },
            ]),
          );
        }
      }

      return { messages };
    } catch (error) {
      log(`Error in proposal chat handler: ${error.message}`);
      return { messages };
    }
  }

  @Command(["council", "list"])
  @Description("List active votes")
  @Permission("player")
  async listVotes(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; votes?: Vote[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const votes = await this.getAllVotes(kv);
      const activeVotes = votes.filter((v) => v.status === "active");

      if (activeVotes.length === 0) {
        messages = await tellraw(
          sender,
          JSON.stringify([
            { text: "No active votes.\n", color: "yellow" },
            {
              text: "[View History]",
              color: "aqua",
              clickEvent: {
                action: "run_command",
                value: "/council history",
              },
            },
          ]),
        );
        return { messages, votes: [] };
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "📊 Active Council Votes 📊\n", color: "gold", bold: true },
          {
            text: "Click a vote to view full details\n\n",
            color: "gray",
            italic: true,
          },
        ]),
      );

      for (const vote of activeVotes) {
        const totalVotes = vote.voters.size;
        const timeLeft = this.getTimeRemaining(vote.expiresAt);
        const leadingOption = [...vote.options].sort((a, b) =>
          b.votes - a.votes
        )[0];
        const leadingPercentage = totalVotes > 0
          ? Math.round((leadingOption.votes / totalVotes) * 100)
          : 0;
        const hasVoted = vote.voters.has(sender);

        // Create progress bar for leading option
        const progressBar = this.renderProgressBar(
          leadingOption.votes,
          totalVotes,
        );
        const progressColor = this.getProgressBarColor(
          leadingOption.votes,
          totalVotes,
        );

        messages = await tellraw(
          sender,
          JSON.stringify([
            // Vote title and basic info
            {
              text: vote.title + "\n",
              color: "yellow",
              clickEvent: {
                action: "run_command",
                value: `/council view ${vote.id}`,
              },
              hoverEvent: {
                action: "show_text",
                value: "Click to view vote details",
              },
            },
            { text: "By: ", color: "gray" },
            { text: vote.author, color: "green" },
            { text: " • ", color: "gray" },
            { text: `${timeLeft} remaining\n`, color: "aqua" },

            // Progress bar and stats
            { text: progressBar + " ", color: progressColor },
            {
              text: `${leadingOption.votes}/${totalVotes} votes`,
              color: "gray",
            },
            { text: ` (${leadingPercentage}%)\n`, color: progressColor },

            // Leading option
            { text: "Leading: ", color: "gray" },
            { text: `${leadingOption.text}\n`, color: progressColor },

            // Vote status
            hasVoted
              ? [
                { text: "✓ ", color: "green" },
                { text: "You have voted\n", color: "gray" },
              ]
              : [
                {
                  text: "[Vote Now]",
                  color: "green",
                  clickEvent: {
                    action: "run_command",
                    value: `/council view ${vote.id}`,
                  },
                  hoverEvent: {
                    action: "show_text",
                    value: "Click to vote",
                  },
                },
                { text: "\n" },
              ],
            { text: "⎯".repeat(30) + "\n", color: "dark_gray" },
          ]),
        );
      }

      // Add footer with total count
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: `\nTotal active votes: `, color: "gray" },
          { text: `${activeVotes.length}`, color: "yellow" },
          { text: ` • `, color: "gray" },
          {
            text: "[Refresh]",
            color: "green",
            clickEvent: {
              action: "run_command",
              value: "/council list",
            },
          },
          { text: " • ", color: "gray" },
          {
            text: "[History]",
            color: "aqua",
            clickEvent: {
              action: "run_command",
              value: "/council history",
            },
          },
        ]),
      );

      log(`Active votes listed by ${sender}`);
      return { messages, votes: activeVotes };
    } catch (error) {
      log(`Error listing votes: ${error.message}`);
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

  @Command(["council", "view"])
  @Description("View vote details")
  @Permission("player")
  @Argument([
    { name: "id", type: "string", description: "Vote ID" },
  ])
  async viewVote(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; vote?: Vote }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const vote = await this.getVote(kv, args.id);
      if (!vote) {
        throw new Error("Vote not found");
      }

      const totalVotes = vote.voters.size;
      const hasVoted = vote.voters.has(sender);
      const timeLeft = this.getTimeRemaining(vote.expiresAt);
      const isExpired = new Date(vote.expiresAt) <= new Date();

      messages = await tellraw(
        sender,
        JSON.stringify([
          // Vote header
          { text: "=== Council Vote ===\n", color: "gold", bold: true },
          { text: vote.title + "\n", color: "yellow", bold: true },

          // Vote info
          { text: "Proposed by: ", color: "gray" },
          { text: vote.author + "\n", color: "green" },
          { text: "Status: ", color: "gray" },
          {
            text: vote.status.toUpperCase() + "\n",
            color: vote.status === "active"
              ? "green"
              : vote.status === "passed"
              ? "aqua"
              : vote.status === "failed"
              ? "red"
              : "gray",
          },
          { text: "Created: ", color: "gray" },
          {
            text: new Date(vote.createdAt).toLocaleString() + "\n",
            color: "white",
          },
          vote.status === "active"
            ? [
              { text: "Time left: ", color: "gray" },
              { text: timeLeft + "\n", color: "aqua" },
            ]
            : [],

          // Description
          { text: "\nDescription:\n", color: "gold" },
          { text: vote.description + "\n\n", color: "white" },

          // Vote options
          { text: "Options:\n", color: "gold" },
        ]),
      );

      // Display each option with progress bar
      for (const option of vote.options) {
        const percentage = totalVotes > 0
          ? Math.round((option.votes / totalVotes) * 100)
          : 0;
        const progressBar = this.renderProgressBar(option.votes, totalVotes);
        const progressColor = this.getProgressBarColor(
          option.votes,
          totalVotes,
        );

        const optionDisplay = [
          vote.status === "active" && !hasVoted
            ? {
              text: `[Vote] `,
              color: "green",
              clickEvent: {
                action: "run_command",
                value: `/council vote ${vote.id} ${option.id}`,
              },
              hoverEvent: {
                action: "show_text",
                value: "Click to vote for this option",
              },
            }
            : { text: "• ", color: "gray" },
          { text: option.text + "\n", color: "yellow" },
          { text: progressBar + " ", color: progressColor },
          { text: `${option.votes}/${totalVotes}`, color: "gray" },
          { text: ` (${percentage}%)\n`, color: progressColor },
        ];

        messages = await tellraw(sender, JSON.stringify(optionDisplay));
      }

      // Footer with actions
      const footer = [
        { text: "\nTotal votes: ", color: "gray" },
        { text: `${totalVotes}\n`, color: "yellow" },
      ];

      if (vote.status === "active") {
        if (hasVoted) {
          footer.push(
            { text: "✓ ", color: "green" },
            { text: "You have already voted\n", color: "gray" },
          );
        } else {
          footer.push(
            { text: "You haven't voted yet\n", color: "gray" },
          );
        }
      }

      messages = await tellraw(sender, JSON.stringify(footer));

      log(`Vote ${args.id} viewed by ${sender}`);
      return { messages, vote };
    } catch (error) {
      log(`Error viewing vote: ${error.message}`);
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
  @Command(["council", "vote"])
  @Description("Cast your vote")
  @Permission("player")
  @Argument([
    { name: "id", type: "string", description: "Vote ID" },
    { name: "optionId", type: "string", description: "Option ID" },
  ])
  async castVote(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const vote = await this.getVote(kv, args.id);
      if (!vote) {
        throw new Error("Vote not found");
      }

      if (vote.status !== "active") {
        throw new Error("This vote is no longer active");
      }

      if (vote.voters.has(sender)) {
        throw new Error("You have already voted");
      }

      if (new Date(vote.expiresAt) <= new Date()) {
        throw new Error("This vote has expired");
      }

      const option = vote.options.find((opt) => opt.id === args.optionId);
      if (!option) {
        throw new Error("Invalid option");
      }

      // Update vote counts
      option.votes++;
      option.voters.add(sender);
      vote.voters.add(sender);

      await kv.set(["council", "votes", args.id], vote);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Vote Cast Successfully!\n", color: "green", bold: true },
          { text: "Your vote: ", color: "gray" },
          { text: option.text + "\n", color: "yellow" },
        ]),
      );

      // Notify vote author
      await tellraw(
        vote.author,
        JSON.stringify([
          { text: "New vote on your proposal!\n", color: "gold" },
          { text: vote.title + "\n", color: "yellow" },
          {
            text: "[View Details]",
            color: "aqua",
            clickEvent: {
              action: "run_command",
              value: `/council view ${vote.id}`,
            },
          },
        ]),
      );

      log(`${sender} voted on "${vote.title}"`);
      return { messages, success: true };
    } catch (error) {
      log(`Error casting vote: ${error.message}`);
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

  @Command(["council", "history"])
  @Description("View past votes")
  @Permission("player")
  async viewHistory(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; votes?: Vote[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const votes = await this.getAllVotes(kv);
      const completedVotes = votes.filter((v) => v.status !== "active")
        .sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      if (completedVotes.length === 0) {
        messages = await tellraw(
          sender,
          JSON.stringify({
            text: "No completed votes found.",
            color: "yellow",
          }),
        );
        return { messages, votes: [] };
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "📚 Council Vote History 📚\n", color: "gold", bold: true },
        ]),
      );

      for (const vote of completedVotes) {
        const totalVotes = vote.voters.size;
        const winningOption = [...vote.options].sort((a, b) =>
          b.votes - a.votes
        )[0];
        const winPercentage = totalVotes > 0
          ? Math.round((winningOption.votes / totalVotes) * 100)
          : 0;

        messages = await tellraw(
          sender,
          JSON.stringify([
            { text: vote.title + "\n", color: "yellow" },
            { text: "Status: ", color: "gray" },
            {
              text: vote.status.toUpperCase() + "\n",
              color: vote.status === "passed"
                ? "green"
                : vote.status === "failed"
                ? "red"
                : "gray",
            },
            { text: "Result: ", color: "gray" },
            { text: winningOption.text + "\n", color: "aqua" },
            { text: "Votes: ", color: "gray" },
            {
              text: `${totalVotes} (${winPercentage}% in favor)\n`,
              color: "yellow",
            },
            {
              text: "[View Details]",
              color: "aqua",
              clickEvent: {
                action: "run_command",
                value: `/council view ${vote.id}`,
              },
            },
            { text: "\n⎯".repeat(20) + "\n", color: "dark_gray" },
          ]),
        );
      }

      log(`Vote history viewed by ${sender}`);
      return { messages, votes: completedVotes };
    } catch (error) {
      log(`Error viewing history: ${error.message}`);
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

  @Command(["council", "cancel"])
  @Description("Cancel an active vote")
  @Permission("operator")
  @Argument([
    { name: "id", type: "string", description: "Vote ID" },
  ])
  async cancelVote(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const vote = await this.getVote(kv, args.id);
      if (!vote) {
        throw new Error("Vote not found");
      }

      if (vote.status !== "active") {
        throw new Error("This vote is not active");
      }

      // Update vote status
      vote.status = "cancelled";
      await kv.set(["council", "votes", args.id], vote);

      // Notify all online players
      messages = await tellraw(
        "@a",
        JSON.stringify([
          { text: "⚠️ Vote Cancelled ⚠️\n", color: "red", bold: true },
          { text: vote.title + "\n", color: "yellow" },
          { text: "Cancelled by: ", color: "gray" },
          { text: sender, color: "red" },
        ]),
      );

      log(`Vote "${vote.title}" cancelled by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error cancelling vote: ${error.message}`);
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

  @Event("timer_hourly")
  async processExpiredVotes(
    { kv, tellraw, log }: ScriptContext,
  ): Promise<void> {
    try {
      const votes = await this.getAllVotes(kv);
      const now = new Date();

      for (const vote of votes) {
        if (vote.status === "active" && new Date(vote.expiresAt) <= now) {
          // Count votes and determine result
          const totalVotes = vote.voters.size;
          const options = [...vote.options].sort((a, b) => b.votes - a.votes);
          const winningOption = options[0];
          const winPercentage = totalVotes > 0
            ? (winningOption.votes / totalVotes) * 100
            : 0;

          // Default requirements: 50% participation, simple majority
          const requiredVotes = vote.requiredVotes || 1; // At least 1 vote
          const minYesPercentage = vote.minYesPercentage || 50; // 50% default threshold

          // Determine if vote passed
          const passed = totalVotes >= requiredVotes &&
            winPercentage >= minYesPercentage;
          vote.status = passed ? "passed" : "failed";

          await kv.set(["council", "votes", vote.id], vote);

          // Announce result
          await tellraw(
            "@a",
            JSON.stringify([
              { text: "📢 Vote Concluded 📢\n", color: "gold", bold: true },
              { text: vote.title + "\n", color: "yellow" },
              { text: "Result: ", color: "gray" },
              {
                text: vote.status.toUpperCase() + "\n",
                color: vote.status === "passed" ? "green" : "red",
                bold: true,
              },
              { text: "Winning option: ", color: "gray" },
              { text: winningOption.text + "\n", color: "aqua" },
              {
                text: `${winningOption.votes}/${totalVotes} votes `,
                color: "yellow",
              },
              { text: `(${Math.round(winPercentage)}%)\n`, color: "aqua" },
              {
                text: "[View Details]",
                color: "yellow",
                clickEvent: {
                  action: "run_command",
                  value: `/council view ${vote.id}`,
                },
              },
            ]),
          );

          log(`Vote "${vote.title}" concluded: ${vote.status}`);
        }
      }
    } catch (error) {
      log(`Error processing expired votes: ${error.message}`);
    }
  }

  @Command(["council", "requirements"])
  @Description("Set vote requirements")
  @Permission("operator")
  @Argument([
    { name: "id", type: "string", description: "Vote ID" },
    {
      name: "minVotes",
      type: "integer",
      description: "Minimum required votes",
    },
    {
      name: "minPercentage",
      type: "integer",
      description: "Minimum yes percentage",
    },
  ])
  async setRequirements(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const vote = await this.getVote(kv, args.id);
      if (!vote) {
        throw new Error("Vote not found");
      }

      if (vote.status !== "active") {
        throw new Error("Can only set requirements for active votes");
      }

      if (args.minVotes < 1) {
        throw new Error("Minimum votes must be at least 1");
      }

      if (args.minPercentage < 0 || args.minPercentage > 100) {
        throw new Error("Minimum percentage must be between 0 and 100");
      }

      vote.requiredVotes = args.minVotes;
      vote.minYesPercentage = args.minPercentage;
      await kv.set(["council", "votes", args.id], vote);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Vote Requirements Updated\n", color: "green", bold: true },
          { text: "Required votes: ", color: "gray" },
          { text: `${args.minVotes}\n`, color: "yellow" },
          { text: "Required percentage: ", color: "gray" },
          { text: `${args.minPercentage}%`, color: "yellow" },
        ]),
      );

      log(`Vote requirements updated for "${vote.title}" by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error setting requirements: ${error.message}`);
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

  @Command(["council", "stats"])
  @Description("View voting statistics")
  @Permission("player")
  async viewStats(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const votes = await this.getAllVotes(kv);
      const totalVotes = votes.length;
      const activeVotes = votes.filter((v) => v.status === "active").length;
      const passedVotes = votes.filter((v) => v.status === "passed").length;
      const failedVotes = votes.filter((v) => v.status === "failed").length;
      const cancelledVotes = votes.filter((v) =>
        v.status === "cancelled"
      ).length;

      const mostVoted = votes.reduce(
        (max, vote) => vote.voters.size > (max?.voters.size || 0) ? vote : max,
        null as Vote | null,
      );

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "📊 Council Statistics 📊\n", color: "gold", bold: true },
          { text: "\nTotal Votes: ", color: "gray" },
          { text: `${totalVotes}\n`, color: "yellow" },
          { text: "Active: ", color: "gray" },
          { text: `${activeVotes}\n`, color: "green" },
          { text: "Passed: ", color: "gray" },
          { text: `${passedVotes}\n`, color: "aqua" },
          { text: "Failed: ", color: "gray" },
          { text: `${failedVotes}\n`, color: "red" },
          { text: "Cancelled: ", color: "gray" },
          { text: `${cancelledVotes}\n`, color: "gray" },
          mostVoted
            ? [
              { text: "\nMost Voted Proposal:\n", color: "gold" },
              { text: mostVoted.title + "\n", color: "yellow" },
              { text: `${mostVoted.voters.size} votes`, color: "aqua" },
            ]
            : [],
        ]),
      );

      log(`Statistics viewed by ${sender}`);
      return { messages };
    } catch (error) {
      log(`Error viewing stats: ${error.message}`);
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
}
