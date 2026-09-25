/**
 * Every request/response type the UI uses comes from the shared contract package
 * (`packages/contract`), where they are zod schemas. This file used to be hand-written and
 * drifted from the server (wrong duration-class literal, an `ActiveMission` carrying fields the
 * API never sent); it now only re-exports, so the name the screens import stays stable while the
 * shapes have a single source that the API's contract test checks against real responses.
 */
export type * from '@rustandspark/contract';
