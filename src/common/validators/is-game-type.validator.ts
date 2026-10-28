import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { GAME_ENGINES } from '../../games/game-registry';

export function IsGameType(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGameType',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && value in GAME_ENGINES;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be one of: ${Object.keys(GAME_ENGINES).join(', ')}`;
        },
      },
    });
  };
}
