import { join } from 'path';

// Reusable go runtime specific string literals
export const TARGET_PATH_DEV = join('target', 'debug');
export const TARGET_PATH_PROD = join('target', 'release');
export const SRC = 'src';
export const MAIN_BINARY = 'bootstrap';
export const RUST_SELECTION = 'rust';
export const RUST_NAME = 'Rust';
// Ref: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
// Also: https://github.com/awslabs/aws-lambda-rust-runtime
export const RUST_RUNTIME = 'provided.al2';

export const CARGO_CMD = 'cargo';
export const DOCKER_CMD = 'docker';
export const RUSTUP_CMD = 'rustup';
export const TARGET_NAME_PROD = 'x86_64-unknown-linux-gnu';

export const BASE_PORT = 8900;
export const MAX_PORT = 9999;