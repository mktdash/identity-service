import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { env, isTest } from "#config/env";

let sdk: NodeSDK | undefined;

if (!isTest) {
  sdk = new NodeSDK({
    serviceName: env.SERVICE_NAME,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (request) => {
            const url = request.url ?? "";
            return url.startsWith("/health") || url.startsWith("/ready");
          },
        },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
