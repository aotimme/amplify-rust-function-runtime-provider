import path from 'path';

import { $TSContext } from 'amplify-cli-core';
import { BuildType, InvocationRequest } from 'amplify-function-plugin-interface';
import execa, { ExecaChildProcess } from 'execa';
import portfinder from 'portfinder';

import { BASE_PORT, MAX_PORT, SRC } from './constants';
import { getBuildBinaryPath } from './utils';
import { LambdaRuntimeApi } from './lambda-runtime-api';


type AnyRequest = any;
type AnyResponse = any;

export const localInvoke = async (request: InvocationRequest, context: $TSContext) => {
  const portNumber = await portfinder.getPortPromise({
    startPort: BASE_PORT,
    stopPort: MAX_PORT,
  });

  // Start Lambda Runtime API
  const lambdaRuntimeApi = new LambdaRuntimeApi<AnyRequest, AnyResponse>(portNumber);
  context.print.info(`Starting Lambda Runtime API on port ${portNumber}...`);
  await lambdaRuntimeApi.start();

  // Start Lambda function
  // NOTE: `amplify mock function` appears to handle re-building the
  // function if necessary.
  const rustSrcDir = path.join(request.srcRoot, SRC);
  const lambdaExecutable = await getBuildBinaryPath(rustSrcDir, BuildType.DEV);
  context.print.info('Starting Lambda Function...');
  const lambdaProcess: ExecaChildProcess = execa(lambdaExecutable, {
    env: {
      AWS_LAMBDA_LOG_GROUP_NAME: 'loggroup',
      AWS_LAMBDA_LOG_STREAM_NAME: 'log',
      AWS_LAMBDA_FUNCTION_VERSION: '1.0',
      AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
      AWS_LAMBDA_FUNCTION_NAME: 'fn',
      // This is the only env var that actually matters.
      // The others just can't be empty/null.
      AWS_LAMBDA_RUNTIME_API: `localhost:${portNumber}`,
    },
  });

  // Send the one event
  context.print.info('Sending event...');
  const requestEvent = JSON.parse(request.event);
  const response = await lambdaRuntimeApi.sendRequest(requestEvent);

  // Stop Lambda function
  context.print.info('Stopping Lambda Function...');
  await lambdaProcess.cancel();

  // Stop Lambda Runtime API
  context.print.info('Stopping Lambda Runtime API...');
  await lambdaRuntimeApi.stop();

  return response;
};