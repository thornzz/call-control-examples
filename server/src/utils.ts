/* tslint:disable:max-classes-per-file */
import { EventEmitter, Transform, TransformCallback } from "stream";
import {
  CallControl,
  CallParticipant,
  DNDevice,
  DNInfo,
  DnInfoModel,
} from "./types";

export function readChunks(reader: ReadableStreamDefaultReader) {
  return {
    async *[Symbol.asyncIterator]() {
      let readResult = await reader.read();
      while (!readResult.done) {
        yield readResult.value;
        readResult = await reader.read();
      }
    },
  };
}
export function determineOperation(entity: string) {
  const path = entity.split("/");
  const id = path[path.length - 1];
  const entityType = path[path.length - 2];
  const dn = path[path.length - 3];
  return { type: entityType, id, dn };
}

export class Queue<T> {
  items = new List<T>();

  push(value: T) {
    this.items.insertEnd(value);
  }

  getAndRemoveFromQueue() {
    return this.items.removeBegin();
  }

  isEmpty() {
    return this.items.head === null;
  }

  clear() {
    this.items.clear();
  }
}

class ListNode<T> {
  value: T;
  prev: ListNode<T> | null;
  next: ListNode<T> | null;
  constructor(value: T, prev: ListNode<T> | null, next: ListNode<T> | null) {
    this.value = value;
    this.prev = prev;
    this.next = next;
  }
}

class List<T> {
  head: ListNode<T> | null = null;
  tail: ListNode<T> | null = null;
  insertBegin(value: T) {
    if (this.head === null) {
      const node = new ListNode(value, null, null);
      this.head = node;
      this.tail = node;
    } else {
      const node = new ListNode(value, null, this.head);
      this.head.prev = node;
      this.head = node;
    }
  }

  insertEnd(value: T) {
    if (this.tail === null) {
      const node = new ListNode(value, null, null);
      this.head = node;
      this.tail = node;
    } else {
      const node = new ListNode(value, this.tail, null);
      this.tail.next = node;
      this.tail = node;
    }
  }

  removeBegin() {
    if (this.head === null) {
      return undefined;
    }

    const result = this.head.value;
    if (this.head === this.tail) {
      this.head = null;
      this.tail = null;
    } else {
      this.head = this.head.next;
      this.head!.prev = null;
    }
    return result;
  }

  removeEnd() {
    if (this.tail === null) {
      return undefined;
    }

    const result = this.tail.value;

    if (this.tail === this.head) {
      this.head = null;
      this.tail = null;
    } else {
      this.tail = this.tail.prev;
      this.tail!.next = null;
    }
  }

  clear() {
    this.head = null;
    this.tail = null;
  }

  [Symbol.iterator]() {
    let currentNode = this.head;
    return {
      next() {
        if (!currentNode) return { value: undefined, done: true };
        const returnValue = {
          value: currentNode.value,
          done: false,
        };
        currentNode = currentNode.next;
        return returnValue;
      },
    };
  }
}

export function fullInfoToObject(fullInfo: DNInfo[]) {
  const fInfo: CallControl = {
    callcontrol: new Map<string, DnInfoModel>(),
  };

  fullInfo.forEach((info) => {
    fInfo.callcontrol.set(info.dn!, {
      dn: info.dn,
      type: info.type,
      devices: devicesToMap(info.devices ?? []),
      participants: participantsToMap(info.participants ?? []),
    });
  });
  return fInfo;
}
export function devicesToMap(device: DNDevice[]) {
  return new Map(device.map((dev) => [dev.device_id!, dev]));
}

export function participantsToMap(participants: CallParticipant[]) {
  return new Map(participants.map((part) => [part.id!.toString(), part]));
}

/**
 * Recursively reads FullInfo Object using URL
 * eg. when hook returns following URL: /callcontrol/999/participant/55
 * it will return fullInfo.callcontrol.get(999).participants.get(55)
 * @param objectParam
 * @param pathParam
 * @param defaultValue
 */
export function get<T>(
  objectParam: Map<string, any> | Record<string, any>,
  pathParam: string,
  defaultValue?: T
): T | undefined {
  const levels = pathParam.split("/").filter((val) => !!val);
  function recursivelyReadObject(
    obj: Map<string, any> | Record<string, any>,
    levels: string[],
    currIdx: number
  ): any {
    const val =
      obj instanceof Map ? obj?.get(levels[currIdx]) : obj?.[levels[currIdx]];
    if (currIdx === levels.length - 1) {
      return val !== undefined ? val : defaultValue;
    } else {
      if (val !== undefined && val !== null) {
        return recursivelyReadObject(val, levels, currIdx + 1);
      } else {
        return defaultValue;
      }
    }
  }
  return recursivelyReadObject(objectParam, levels, 0);
}

/**
 * Makes incremental update of FullInfo Object using URL
 * @param objectParam
 * @param pathParam
 * @param val
 */
export function set<T>(
  objectParam: Map<string, any> | Record<string, any>,
  pathParam: string,
  val: any
): any {
  const levels = pathParam.split("/").filter((val) => !!val);
  const updatingLevel = levels.pop();
  const property: Map<string, any> | Record<string, any> | undefined = get(
    objectParam,
    levels.join("/")
  );
  if (property) {
    if (property instanceof Map) {
      if (val !== undefined && val !== null) {
        property.set(String(updatingLevel), val);
        return val;
      } else {
        const deleting = property.get(String(updatingLevel));
        if (deleting) {
          property.delete(String(updatingLevel));
        }
        return deleting;
      }
    } else {
      if (val !== undefined && val !== null) {
        property[String(updatingLevel)] = val;
        return val;
      } else {
        const deleting = property[String(updatingLevel)];
        if (deleting) {
          delete property[String(updatingLevel)];
        }
        return deleting;
      }
    }
  }
}

export class Stopwatch {
  elapsedStart: null | number = null;

  elapsedMs() {
    if (this.elapsedStart === null) {
      this.elapsedStart = Date.now();
    }
    return Date.now() - this.elapsedStart;
  }
}

export class CancelationToken extends EventEmitter {}

export function writeSlicedAudioStream(
  arr: Uint8Array | Buffer,
  outputWriter: WritableStreamDefaultWriter<any>,
  cancelationToken: CancelationToken
) {
  return new Promise<void>(async (res, rej) => {
    const delay = (time: number) => new Promise((res) => setTimeout(res, time));
    const stopwatch = new Stopwatch();
    let elapsed = stopwatch.elapsedMs();
    const size = arr.length;
    let providedMs = 0;
    let currentPosition = 0;

    let stop = false;
    cancelationToken.once("cancel", () => {
      stop = true;
    });
    try {
      if (providedMs < elapsed) {
        providedMs = elapsed;
      }
      while (size !== currentPosition) {
        if (stop) {
          rej();
          break;
        }
        elapsed = stopwatch.elapsedMs(); // TODO ЗАБЫЛИ
        while (providedMs - elapsed <= 500) {
          const toSend = Math.min(size - currentPosition, 4096);
          if (toSend === 0) {
            console.log("RESOLVED");
            res();
            break;
          }
          await outputWriter.write(
            arr.slice(currentPosition, currentPosition + toSend)
          );
          console.log("WRITED,", currentPosition, "-", toSend);
          currentPosition += toSend;
          providedMs += Math.floor((toSend + 15) / 16);

          elapsed = stopwatch.elapsedMs();
        }

        if (size === currentPosition) {
          res();
        }
        await delay(Math.max(0, (providedMs - elapsed) / 2));
      }
    } catch (err) {
      rej();
    } finally {
      cancelationToken.off("cancel", () => {});
    }
  });
}

export class SSEStream extends Transform {
  constructor() {
    super({
      writableObjectMode: true,
    });
  }

  _transform(data: any, _encoding: BufferEncoding, done: TransformCallback) {
    this.push(`data: ${JSON.stringify(data)}\n\n`);
    done();
  }
}
