import { EggAppConfig, PowerPartial } from 'egg';

export default () => {
  const config = {} as PowerPartial<EggAppConfig>;

  // Egg lowers framework console logging to WARN in the local environment.
  // Keep all development logs on stdout so `npm run dev` is useful without
  // tailing files under logs/.
  config.logger = {
    consoleLevel: 'INFO',
    disableConsoleAfterReady: false,
    coreLogger: {
      consoleLevel: 'INFO',
    },
  };

  config.customLogger = {
    aiLogger: {
      consoleLevel: 'INFO',
    },
  };

  return config;
};
