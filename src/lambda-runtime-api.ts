import crypto from 'crypto';
import { Server } from 'http';

import express from 'express';

// See: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html

const RUNTIME_API_VERSION = '2018-06-01';

type PromiseResolver<T> = (arg: T) => void;
type PromiseRejector<E> = (arg: E) => void;
type Timeout = ReturnType<typeof setTimeout>;

type PromiseResolverRejector<T, E> = {
  resolve: PromiseResolver<T>,
  reject: PromiseRejector<E>,
};

type RequestId = string;

type WrappedRequest<Request> = {
  request: Request,
  requestId: RequestId,
}

type LambdaFunctionError = {
  errorTypeHeader: string,
  errorMessage: string,
  errorType: string,
  stackTrace: string[],
}

export class LambdaRuntimeApi<Request, Response> {
  #port: number;
  #server?: Server;
  #requests: WrappedRequest<Request>[];
  #responseMap: Map<RequestId, PromiseResolverRejector<Response, LambdaFunctionError>>;
  #timeoutId?: Timeout;

  constructor(port: number) {
    this.#port = port;
    this.#requests = [];
    this.#responseMap = new Map<string, PromiseResolverRejector<Response, LambdaFunctionError>>();
  }

  async start(): Promise<void> {
    const app = express();

    app.use(express.raw({
      type: () => true,
    }));

    app.get(`/${RUNTIME_API_VERSION}/runtime/invocation/next`, (req, res) => {
      const sendNextRequest = () => {
        const wrappedRequest = this.#requests.shift();
        if (!wrappedRequest) {
          this.#timeoutId = setTimeout(() => {
            sendNextRequest();
          }, 1000);
          return;
        }
        const {request, requestId} = wrappedRequest;
        res.set({
          'Content-Type': 'application/json',
          'Lambda-Runtime-Aws-Request-Id': requestId,
          'Lambda-Runtime-Deadline-MS': 5000,
          'Lambda-Runtime-Invoked-Function-Arn': '',
          'Lambda-Runtime-Trace-Id': '',
          'Lambda-Runtime-Client-Context': '',
          'Lambda-Runtime-Cognito-Identity': '',
        });
        res.json(request);
      };
      sendNextRequest();
    });

    app.post(`/${RUNTIME_API_VERSION}/runtime/invocation/:requestId/response`, (req, res) => {
      const requestId = req.params.requestId;
      const entry = this.#responseMap.get(requestId);
      if (entry) {
        const response = JSON.parse(req.body) as Response; // TODO: validate??
        entry.resolve(response);
      }
      this.#responseMap.delete(requestId);
      res.end();
    });

    app.post(`/${RUNTIME_API_VERSION}/runtime/invocation/:requestId/error`, (req, res) => {
      const requestId = req.params.requestId;
      const entry = this.#responseMap.get(requestId);
      if (entry) {
        const errorTypeHeader = req.get('Lambda-Runtime-Function-Error-Type');
        const body = JSON.parse(req.body);
        const error = {
          errorTypeHeader,
          errorMessage: body.ErrorRequest.errorMessage,
          errorType: body.ErrorRequest.errorType,
          stackTrace: body.ErrorRequest.stackTrace,
        } as LambdaFunctionError;
        entry.reject(error);
      }
      this.#responseMap.delete(requestId);
      res.end();
    });

    app.post(`/${RUNTIME_API_VERSION}/runtime/init/error`, (req, res) => {
      const errorTypeHeader = req.get('Lambda-Runtime-Function-Error-Type');
      const body = JSON.parse(req.body);
      const error = {
        errorTypeHeader,
        errorMessage: body.ErrorRequest.errorMessage,
        errorType: body.ErrorRequest.errorType,
        stackTrace: body.ErrorRequest.stackTrace,
      } as LambdaFunctionError;
      // Nothing really to do with this error.
      // TODO: maybe make this class an EventEmiter and emit it??
      console.log('error', error);
      res.end();
    });

    return new Promise<void>((resolve) => {
      this.#server = app.listen(this.#port, () => {
        resolve();
      });
    });
  }


  // send message...
  async sendRequest(request: Request): Promise<Response> {
    const requestId = crypto.randomBytes(12).toString('hex');
    const wrappedRequest = {request, requestId};
    this.#requests.push(wrappedRequest);
    return new Promise<Response>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
      } as PromiseResolverRejector<Response, LambdaFunctionError>;
      this.#responseMap.set(requestId, entry);
    });
  }

  async stop(): Promise<void> {
    await this.#closeServer();
    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
    }
  }

  async #closeServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.#server) {
        resolve();
        return;
      }
      this.#server.close(() => {
        resolve();
      });
    });
  }
}