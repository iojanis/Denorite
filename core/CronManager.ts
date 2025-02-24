import type { Logger } from "./logger.ts";

export class CronManager {
  private cronJobs: Map<string, {
    moduleId: string;
    promise: Promise<void>;
    controller: AbortController;
  }> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  registerCron(
    moduleId: string,
    methodName: string,
    cronExpression: string,
    handler: () => Promise<void>,
    options?: { backoffSchedule?: number[] },
  ): void {
    const jobId = `${moduleId}:${methodName}`;

    // Clear any existing cron job for this ID
    this.unregisterCron(jobId);

    try {
      // Create an AbortController for this cron job
      const controller = new AbortController();

      // Create a wrapper handler that checks if the job is aborted
      const wrappedHandler = async () => {
        if (controller.signal.aborted) {
          return;
        }
        try {
          await handler();
        } catch (error) {
          this.logger.error(`Error in cron job ${jobId}: ${error.message}`);
        }
      };

      // Schedule the cron job
      const cronPromise = Deno.cron(
        jobId,
        cronExpression,
        options || {},
        wrappedHandler,
      );

      // Store the job details
      this.cronJobs.set(jobId, {
        moduleId,
        promise: cronPromise,
        controller,
      });

      this.logger.debug(
        `Registered cron job ${jobId} with expression ${cronExpression}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register cron job ${jobId}: ${error.message}`,
      );
    }
  }

  unregisterCron(jobId: string): void {
    const job = this.cronJobs.get(jobId);
    if (job) {
      try {
        // Abort the cron job
        job.controller.abort();
        this.cronJobs.delete(jobId);
        this.logger.debug(`Unregistered cron job ${jobId}`);
      } catch (error) {
        this.logger.error(
          `Error unregistering cron job ${jobId}: ${error.message}`,
        );
      }
    }
  }

  unregisterModuleCrons(moduleId: string): void {
    // Find and unregister all cron jobs for this module
    for (const [jobId, job] of this.cronJobs.entries()) {
      if (job.moduleId === moduleId) {
        this.unregisterCron(jobId);
      }
    }
  }
}
