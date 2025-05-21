import { LoggingService } from '@vai/services';

/**
 * Interface para as opções de medição de performance
 */
export interface PerformanceMeasureOptions {
  /** Nome da medição (para identificação nos logs) */
  name: string;
  /** Serviço de log (opcional) */
  loggingService?: LoggingService;
  /** Se deve log apenas se exceder um determinado tempo (ms) */
  logThreshold?: number;
  /** Detalhes adicionais para incluir no log */
  details?: Record<string, any>;
}

/**
 * Decorator para medir a performance de métodos
 * @param options Opções de medição
 */
export function measurePerformance(options: PerformanceMeasureOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const startTime = performance.now();
      const result = originalMethod.apply(this, args);

      // Se o resultado for uma Promise, medimos quando resolver
      if (result instanceof Promise) {
        return result
          .then((resolvedValue) => {
            const endTime = performance.now();
            const duration = endTime - startTime;

            logPerformance(duration, options, args);

            return resolvedValue;
          })
          .catch((error) => {
            const endTime = performance.now();
            const duration = endTime - startTime;

            logPerformance(
              duration,
              {
                ...options,
                details: {
                  ...options.details,
                  error: error.message || 'Unknown error',
                },
              },
              args,
            );

            throw error;
          });
      }

      // Caso contrário, medimos imediatamente
      const endTime = performance.now();
      const duration = endTime - startTime;

      logPerformance(duration, options, args);

      return result;
    };

    return descriptor;
  };
}

/**
 * Função auxiliar para registrar a performance
 */
function logPerformance(duration: number, options: PerformanceMeasureOptions, args: any[]) {
  // Só log se exceder o threshold ou se não houver threshold
  if (!options.logThreshold || duration >= options.logThreshold) {
    const formattedDuration = duration.toFixed(2);
    const message = `Performance [${options.name}]: ${formattedDuration}ms`;

    // Preparar detalhes para log
    const details = {
      ...(options.details || {}),
      duration,
      args: args.map((arg) =>
        // Resumir objetos grandes para evitar logs gigantes
        typeof arg === 'object' && arg !== null ? `${arg.constructor?.name || 'Object'}(${JSON.stringify(arg).substring(0, 50)}...)` : arg,
      ),
    };

    // Log usando o serviço se disponível, ou console
    if (options.loggingService) {
      if (duration > 500) {
        options.loggingService.warn(message, details);
      } else {
        options.loggingService.debug(message, details);
      }
    } else {
      console.log(message, details);
    }
  }
}

/**
 * Função utilitária para medir a performance de qualquer função
 * @param fn Função a ser medida
 * @param options Opções de medição
 */
export function measureFunctionPerformance<T extends (...args: any[]) => any>(fn: T, options: PerformanceMeasureOptions): T {
  return function (...args: Parameters<T>) {
    const startTime = performance.now();
    const result = fn(...args);

    // Se o resultado for uma Promise, medimos quando resolver
    if (result instanceof Promise) {
      return result
        .then((resolvedValue) => {
          const endTime = performance.now();
          const duration = endTime - startTime;

          logPerformance(duration, options, args);

          return resolvedValue;
        })
        .catch((error) => {
          const endTime = performance.now();
          const duration = endTime - startTime;

          logPerformance(
            duration,
            {
              ...options,
              details: {
                ...options.details,
                error: error.message || 'Unknown error',
              },
            },
            args,
          );

          throw error;
        });
    }

    // Caso contrário, medimos imediatamente
    const endTime = performance.now();
    const duration = endTime - startTime;

    logPerformance(duration, options, args);

    return result;
  } as T;
}
