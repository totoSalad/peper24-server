import { EggAppConfig, PowerPartial } from 'egg';

export default () => {
  const config = {} as PowerPartial<EggAppConfig>;

  // Trust X-Forwarded-* headers from the Nginx container so Egg sees HTTPS
  // and the real client address.
  config.proxy = true;

  // Keep production logs visible through `docker compose logs`.
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
