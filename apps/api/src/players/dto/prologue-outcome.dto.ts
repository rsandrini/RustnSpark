import { IsIn } from 'class-validator';
import { PROLOGUE_OUTCOMES, type PrologueOutcome } from '../prologue.js';

export class PrologueOutcomeDto {
  @IsIn(PROLOGUE_OUTCOMES)
  outcome!: PrologueOutcome;
}
