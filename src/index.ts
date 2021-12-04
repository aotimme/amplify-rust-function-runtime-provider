import { FunctionRuntimeContributorFactory } from 'amplify-function-plugin-interface';
import { checkDependencies, packageResource, buildResource } from './runtime';
import { localInvoke } from './local-invoke';
import { MAIN_BINARY, RUST_NAME, RUST_RUNTIME, RUST_SELECTION } from './constants';

export const functionRuntimeContributorFactory: FunctionRuntimeContributorFactory = context => {
  return {
    contribute: request => {
      if (request.selection !== RUST_SELECTION) {
        return Promise.reject(new Error(`Unknown selection ${request.selection}`));
      }
      return Promise.resolve({
        runtime: {
          name: RUST_NAME,
          value: RUST_SELECTION,
          cloudTemplateValue: RUST_RUNTIME,
          defaultHandler: MAIN_BINARY,
        },
      });
    },
    checkDependencies: runtimeValue => checkDependencies(runtimeValue),
    package: request => packageResource(request, context),
    build: buildResource,
    invoke: request => localInvoke(request, context),
  };
};