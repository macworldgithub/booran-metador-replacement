import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Extracts the current authenticated user from the request object */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
