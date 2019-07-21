/* eslint-disable */

import pino from 'pino';
import {prettyTimestamped} from "./logger/format/pretty-timestamped";
import {pretty} from "./logger/format/pretty";
import {jsonFormat} from "./logger/format/json";

const loggerPino = pino();

// pino.destination('./log.text')

// loggerPino.info('hello world');

const cluster = require('cluster');
const Logger = require('bunyan');
const Error = require('http-errors');
const Stream = require('stream');
const pkgJSON = require('../../package.json');
const _ = require('lodash');

/**
 * A RotatingFileStream that modifes the message first
 */
class VerdaccioRotatingFileStream extends Logger.RotatingFileStream {
  // We depend on mv so that this is there
  write(obj) {
    super.write(jsonFormat(obj, false));
  }
}

let logger;

export interface LoggerTarget {
  type?: string;
  format?: string;
  level?: string;
  options?: any;
  path?: string;
}

const DEFAULT_LOGGER_CONF = [{ type: 'stdout', format: 'pretty', level: 'http' }];

/**
 * Setup the Buyan logger
 * @param {*} logs list of log configuration
 */
function setup(logs) {
  const streams: any = [];
  if (logs == null) {
    logs = DEFAULT_LOGGER_CONF;
  }

  logs.forEach(function(target: LoggerTarget) {
    let level = target.level || 35;
    if (level === 'http') {
      level = 35;
    }

    // create a stream for each log configuration
    if (target.type === 'rotating-file') {
      if (target.format !== 'json') {
        throw new Error('Rotating file streams only work with JSON!');
      }
      if (cluster.isWorker) {
        // https://github.com/trentm/node-bunyan#stream-type-rotating-file
        throw new Error('Cluster mode is not supported for rotating-file!');
      }

      const stream = new VerdaccioRotatingFileStream(
        // @ts-ignore
        _.merge(
          {},
          // Defaults can be found here: https://github.com/trentm/node-bunyan#stream-type-rotating-file
          target.options || {},
          { path: target.path, level }
        )
      );

      const rotateStream: any = {
        // @ts-ignore
        type: 'raw',
        // @ts-ignore
        level,
        // @ts-ignore
        stream,
      };

      streams.push(rotateStream);
    } else {
      const stream = new Stream();
      stream.writable = true;

      let destination;
      let destinationIsTTY = false;
      if (target.type === 'file') {
        // destination stream
        destination = require('fs').createWriteStream(target.path, { flags: 'a', encoding: 'utf8' });
        destination.on('error', function(err) {
          stream.emit('error', err);
        });
      } else if (target.type === 'stdout' || target.type === 'stderr') {
        destination = target.type === 'stdout' ? process.stdout : process.stderr;
        destinationIsTTY = destination.isTTY;
      } else {
        throw Error('wrong target type for a log');
      }

      if (target.format === 'pretty') {
        // making fake stream for pretty printing
        stream.write = obj => {
          destination.write(pretty(obj, destinationIsTTY));
        };
      } else if (target.format === 'pretty-timestamped') {
        // making fake stream for pretty printing
        stream.write = obj => {
          destination.write(prettyTimestamped(obj, destinationIsTTY));
        };
      } else {
        stream.write = obj => {
          destination.write(jsonFormat(obj, destinationIsTTY));
        };
      }

      streams.push({
        // @ts-ignore
        type: 'raw',
        // @ts-ignore
        level,
        // @ts-ignore
        stream: stream,
      });
    }
  });

  // buyan default configuration
  logger = new Logger({
    name: pkgJSON.name,
    streams: streams,
    serializers: {
      err: Logger.stdSerializers.err,
      req: Logger.stdSerializers.req,
      res: Logger.stdSerializers.res,
    },
  });

  process.on('SIGUSR2', function() {
    Logger.reopenFileStreams();
  });
}

export { setup, logger };
