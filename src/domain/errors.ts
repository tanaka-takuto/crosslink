export interface Problem {
  code: string;
  message: string;
}

export class CrosslinkError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CrosslinkError";
  }
}

export function problem(error: unknown): Problem {
  return {
    code: error instanceof CrosslinkError ? error.code : "IO_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
