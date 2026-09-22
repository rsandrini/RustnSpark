import type { ValidationPipeOptions } from '@nestjs/common';

// whitelist + forbidNonWhitelisted: an unknown body property is a 400, never silently dropped or accepted.
export const validationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
