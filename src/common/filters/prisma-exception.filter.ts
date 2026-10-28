import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const [statusCode, message] = this.map(exception);

    res.status(statusCode).json({ statusCode, message });
  }

  private map(exception: Prisma.PrismaClientKnownRequestError): [number, string] {
    switch (exception.code) {
      case 'P2002':
        return [HttpStatus.CONFLICT, 'Already taken'];
      case 'P2025':
        return [HttpStatus.NOT_FOUND, 'Record not found'];
      case 'P2003':
        return [HttpStatus.BAD_REQUEST, 'Related record is missing'];
      default:
        return [HttpStatus.INTERNAL_SERVER_ERROR, 'Database error'];
    }
  }
}
