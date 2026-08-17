import 'dotenv/config';
import { EggAppConfig, EggAppInfo, PowerPartial } from 'egg';

// Some OpenAI-compatible models run structured output in compatibility mode
// (schema injected into the system message) and emit a "compatibility" warning.
// That is expected noise; drop it while still
// forwarding real warnings (deprecated, unsupported) to the default process
// warning output. See `logWarnings` in the ai SDK.
interface AIWarning {
  type: string;
  feature?: string;
  setting?: string;
  message?: string;
  details?: string;
}

const filterAiSdkWarnings = (options: {
  warnings: AIWarning[];
  provider?: string;
  model?: string;
}) => {
  const scope = options.provider != null && options.model != null
    ? ` (${options.provider} / ${options.model})`
    : '';
  for (const warning of options.warnings) {
    if (warning.type === 'compatibility') continue;
    const prefix = `AI SDK Warning${scope}:`;
    let message: string;
    if (warning.type === 'unsupported') {
      message = `${prefix} The feature "${warning.feature}" is not supported.`;
      if (warning.details) message += ` ${warning.details}`;
    } else if (warning.type === 'deprecated') {
      message = `${prefix} Deprecated: "${warning.setting}". ${warning.message}`;
    } else if (warning.type === 'other') {
      message = `${prefix} ${warning.message}`;
    } else {
      message = `${prefix} ${JSON.stringify(warning)}`;
    }
    process.emitWarning(message, {
      type: warning.type === 'deprecated' ? 'DeprecationWarning' : 'Warning',
    });
  }
};

(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = filterAiSdkWarnings;

export default (appInfo: EggAppInfo) => {
  const config = {} as PowerPartial<EggAppConfig>;

  // override config from framework / plugin
  config.keys = process.env.APP_KEYS ?? `${appInfo.name}_local_development_key`;

  // add your egg config in here
  config.middleware = [ 'requestContext', 'errorHandler', 'requestSecurity' ];

  // Cookie-based browser requests are protected by requestSecurity's strict
  // Origin and JSON checks instead of Egg's token-based CSRF middleware.
  config.security = {
    csrf: { enable: false },
  };

  // change multipart mode to file
  // @see https://github.com/eggjs/multipart/blob/master/src/config/config.default.ts#L104
  config.multipart = {
    mode: 'file',
  };

  // AI logs (message lifecycle + tool usage) land in their own file
  // (logs/<appname>/ai.log) instead of the shared request log. tegg registers
  // every customLogger name as an injectable, so services can @Inject('aiLogger').
  config.customLogger = {
    aiLogger: {
      file: 'ai.log',
      level: 'INFO',
    },
  };

  return {
    ...config,
  };
};
