import { Injectable } from '@nestjs/common';

// Injectable wall clock: services that compute elapsed time (the scavenging cooldown)
// read it instead of Date.now() so tests can move time forward without sleeping
// (review item 9). One source of "now" per call — never cached.
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
