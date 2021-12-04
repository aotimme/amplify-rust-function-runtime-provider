import {
  CheckDependenciesResult,
  PackageRequest,
  PackageResult,
  BuildRequest,
  BuildResult,
  BuildType,
} from 'amplify-function-plugin-interface';
import * as which from 'which';
import execa from 'execa';
import archiver from 'archiver';
import fs from 'fs-extra';
import glob from 'glob';
import path from 'path';
import {
  SRC,
  MAIN_BINARY,
  CARGO_CMD,
  DOCKER_CMD,
  RUSTUP_CMD,
  TARGET_NAME_PROD
} from './constants';
import { getBuildBinaryPath } from './utils';


export const checkDependencies = async (_runtimeValue: string): Promise<CheckDependenciesResult> => {
  // NOTE: Do we need to check the Rust version?
  // Presumably not since it will just be a binary at the end of the day.

  // Check that `cargo` is in the path, which is needed for DEV builds for all platforms,
  // and for PROD builds on linux.
  if (which.sync(CARGO_CMD) == null) {
    return {
      hasRequiredDependencies: false,
      errorMessage: `${CARGO_CMD} executable was not found in PATH, make sure it's available. It can be installed from https://rustup.rs/`,
    }
  }

  if (process.platform === 'linux') {
    // When we are on a linux box, we will directly build with
    // `cargo build --release --target x86_64-unknown-linux-gnu`
    // So we just need to check that that target has been added (via `rustup`).

    // Check that `rustup` is in the path
    if (which.sync(RUSTUP_CMD) == null) {
      return {
        hasRequiredDependencies: false,
        errorMessage: `${RUSTUP_CMD} executable was not found in PATH, make sure it's available. It can be installed from https://rustup.rs/`,
      }
    }

    // When on Linux, we will just use `cargo build`
    const targetListOutput = await execa(RUSTUP_CMD, ['target', 'list', '--installed']);
    const hasTarget = targetListOutput.stdout.split('\n').some((target) => target == TARGET_NAME_PROD);
    if (!hasTarget) {
      return {
        hasRequiredDependencies: false,
        errorMessage: `Missing target ${TARGET_NAME_PROD}. It can be added via \`rustup target add ${TARGET_NAME_PROD}\`.`,
      }
    }
  } else {
    // When we are _not_ on a linux box, use Docker.

    if (which.sync(DOCKER_CMD) == null) {
      return {
        hasRequiredDependencies: false,
        errorMessage: `${DOCKER_CMD} executable was not found in PATH, make sure it's available. It can be installed from https://docs.docker.com/get-docker/`,
      }
    }
  }

  return {
    hasRequiredDependencies: true,
  };
};

export const buildResource = async ({ buildType, srcRoot, lastBuildTimeStamp }: BuildRequest): Promise<BuildResult> => {
  // `srcRoot` is `amplify/backend/function/<function-name>`
  // `rustSrcDir` is `amplify/backend/function/<function-name>/src`
  // contains, the Rust code (e.g. `Cargo.toml`, `Cargo.lock`, and `src/`)

  const rustSrcDir = path.join(srcRoot, SRC);

  const buildBinaryPath = await getBuildBinaryPath(rustSrcDir, buildType);
  const isBinaryExist = fs.existsSync(buildBinaryPath);

  if (isBinaryExist && lastBuildTimeStamp && !isBuildStale(rustSrcDir, lastBuildTimeStamp)) {
    return {
      rebuilt: false,
    };
  }

  const {command, args} = getBuildArgs(rustSrcDir, buildType);
  const buildOutput = await execa(command, args, {cwd: rustSrcDir});
  if (buildOutput.exitCode !== 0) {
    throw new Error(`Build failed, exit code was ${buildOutput.exitCode}`);
  }

  return {
    rebuilt: true,
  };
};

type BuildArgs = {
  command: string,
  args: string[],
};

const getBuildArgs = (resourceDir: string, buildType: BuildType): BuildArgs => {
  // Dev build is simple
  if (buildType === BuildType.DEV) {
    return {
      command: CARGO_CMD,
      args: ['build'],
    };
  }

  // Prod build is more complex...
  if (process.platform === 'linux') {
    return {
      command: CARGO_CMD,
      args: ['build', '--release', '--target', TARGET_NAME_PROD],
    };
  }

  // See: https://github.com/awslabs/aws-lambda-rust-runtime
  // In particular, "Building on MacOS Using Docker"
  const lambdaArch = 'linux/amd64';
  const rustVersion = 'latest';
  return {
    command: DOCKER_CMD,
    args: [
      'run',
      '--platform',
      lambdaArch,
      '--rm',
      '--user',
      '"$(id -u)":"$(id: -g)"',
      '-v',
      `${resourceDir}:/usr/src/myapp`,
      '-w',
      '/usr/src/myapp',
      `rust:${rustVersion}`,
      CARGO_CMD,
      'build',
      '--release',
      '--target',
      TARGET_NAME_PROD,
    ],
  }
}

const isBuildStale = (resourceDir: string, lastBuildTimeStamp: Date): boolean => {
  // Check `Cargo.toml` file.
  const cargoTomlFile = path.join(resourceDir, 'Cargo.toml');
  const cargoTomlMtime = new Date(fs.statSync(cargoTomlFile).mtime);
  if (cargoTomlMtime > lastBuildTimeStamp) {
    return true;
  }

  // Check `Cargo.lock` file.
  const cargoLockFile = path.join(resourceDir, 'Cargo.lock');
  if (!fs.existsSync(cargoLockFile)) {
    return true;
  }
  const cargoLockMtime = new Date(fs.statSync(cargoLockFile).mtime);
  if (cargoLockMtime > lastBuildTimeStamp) {
    return true;
  }

  // Check source files.
  const srcDir = path.join(resourceDir, SRC);

  // If the timestamp of the src directory is newer than last build, rebuild required
  const srcDirTime = new Date(fs.statSync(srcDir).mtime);
  if (srcDirTime > lastBuildTimeStamp) {
    return true;
  }

  // Check all src files and the Cargo.toml and Cargo.lock files.
  const isFileUpdatedAfterLastBuild = glob.sync(`${srcDir}/**`)
    .some((file) => new Date(fs.statSync(file).mtime) > lastBuildTimeStamp);

  return isFileUpdatedAfterLastBuild;
}

export const packageResource = async (request: PackageRequest, context: any): Promise<PackageResult> => {
  if (request.lastPackageTimeStamp && request.lastPackageTimeStamp >= request.lastBuildTimeStamp && !request.currentHash) {
    // No repackaging necessary.
    return {};
  }

  const resourceDir = request.srcRoot;

  // Figure out where the binary is
  const binFile = await getBuildBinaryPath(resourceDir, BuildType.PROD);

  // Even though it's called `hashDir`, it will also hash a single file.
  const packageHash = !request.skipHashing ? await context.amplify.hashDir(binFile) : undefined;

  await zipBinary(binFile, request.dstFilename);

  return {packageHash};
}

const zipBinary = async (binFile: string, dest: string): Promise<void> => {
  const file = fs.createWriteStream(dest);
  return new Promise<void>((resolve, reject) => {
    file.on('close', () => {
      resolve();
    });

    file.on('error', (err) => {
      reject(new Error(`Failed to zip with error: [${err}]`));
    });

    const zip = archiver.create('zip', {});
    zip.pipe(file);

    zip.file(binFile, {
      name: MAIN_BINARY,
      mode: 755,
    });

    zip.finalize();
  });
}