import pino from 'pino';
import { appConfig } from '../core/config';

const transport = appConfig.prettyLogs
  ? pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  })
  : undefined;

export const logger = pino({
  level: appConfig.logLevel,
  base: appConfig.isProduction ? undefined : { env: appConfig.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
}, transport);
