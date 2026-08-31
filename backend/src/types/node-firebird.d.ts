import 'node-firebird';
import { EventEmitter } from 'events';

declare module 'node-firebird' {
  interface Database extends EventEmitter {}
}