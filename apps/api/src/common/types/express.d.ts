import 'express';

declare global {
  namespace Express {
    interface Request {
      body?: {
        taskId?: string;
      };
    }
  }
}

export {};
