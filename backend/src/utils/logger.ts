import pino from "pino";

type LoggerLevel = "info" | "debug";

const resolveLevel = (): LoggerLevel => {
  const configured = (process.env.LOG_LEVEL || "info").toLowerCase();
  return configured === "debug" ? "debug" : "info";
};

const pinoLogger = pino({
  level: resolveLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
});

const write = (level: LoggerLevel, args: unknown[]): void => {
  if (args.length === 0) return;

  if (args.length === 1) {
    pinoLogger[level](args[0]);
    return;
  }

  const [first, ...rest] = args;
  if (typeof first === "string") {
    pinoLogger[level]({ context: rest }, first);
    return;
  }

  pinoLogger[level]({ context: args });
};

const logger = {
  info: (...args: unknown[]) => write("info", args),
  debug: (...args: unknown[]) => write("debug", args),
};

export default logger;
