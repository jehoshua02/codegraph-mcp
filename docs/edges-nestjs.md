# Implicit Edges: NestJS


## 1 Routing & Controllers

| Pattern | Edge | Detectable |
|---------|------|------------|
| `@Controller('path')` | Decorator → class as route handler | ✅ |
| `@Get`/`@Post`/`@Put`/`@Delete`/`@Patch` | Decorator → method as route handler | ✅ |
| `@Param`/`@Query`/`@Body` | Decorator → method parameter binding | ✅ |
| `@UseGuards(AuthGuard)` | Decorator → guard class `canActivate()` | ✅ |
| `@UseInterceptors(LogInterceptor)` | Decorator → interceptor class `intercept()` | ✅ |
| `@UsePipes(ValidationPipe)` | Decorator → pipe class `transform()` | ✅ |
| `@UseFilters(HttpExceptionFilter)` | Decorator → filter class `catch()` | ✅ |

## 2 Dependency Injection

| Pattern | Edge | Detectable |
|---------|------|------------|
| Constructor injection | Constructor param type → provider class | ✅ |
| `@Inject(TOKEN)` | String/symbol token → provider | ✅ |
| `@Injectable()` | Marks class as DI-managed provider | ✅ |
| Module `providers` array | Module → provider classes | ✅ |
| Module `imports` array | Module → imported module | ✅ |
| Module `exports` array | Module → exported providers | ✅ |
| Module `controllers` array | Module → controller classes | ✅ |
| Custom providers (`useClass`/`useFactory`/`useValue`) | Token → concrete implementation | ✅ |
| `@Optional()` | Marks injection as optional | ✅ |
| `forRoot()`/`forRootAsync()` | Dynamic module config → providers | ⚠️ |

## 3 Middleware & Lifecycle

| Pattern | Edge | Detectable |
|---------|------|------------|
| `NestModule.configure()` | `consumer.apply(Middleware).forRoutes(...)` → middleware class | ✅ |
| `OnModuleInit` / `OnModuleDestroy` | Lifecycle interface → `onModuleInit()`/`onModuleDestroy()` | ✅ |
| `OnApplicationBootstrap` / `OnApplicationShutdown` | Lifecycle → method | ✅ |
| Global pipes/guards/interceptors | `app.useGlobalPipes(...)` → class | ✅ |

## 4 Events & Messaging

| Pattern | Edge | Detectable |
|---------|------|------------|
| `EventEmitter2` emit/on | `this.eventEmitter.emit('event')` → `@OnEvent('event')` handler | ✅ |
| CQRS commands | `commandBus.execute(new CreateUserCommand())` → `@CommandHandler` | ✅ |
| CQRS queries | `queryBus.execute(new GetUserQuery())` → `@QueryHandler` | ✅ |
| CQRS events/sagas | `eventBus.publish(new UserCreatedEvent())` → `@EventsHandler` | ✅ |
| Microservice `@MessagePattern` | Pattern string → handler method | ✅ |
| Microservice `@EventPattern` | Event string → handler method | ✅ |

## 5 Validation & Transformation

| Pattern | Edge | Detectable |
|---------|------|------------|
| DTO class-validator decorators | `@IsString()`, `@IsEmail()` → validation rule | ✅ |
| class-transformer `@Transform` | Decorator → transform function | ✅ |
| `@Type(() => ChildDto)` | Nested DTO → child class | ✅ |

## 6 Database (TypeORM / Prisma)

| Pattern | Edge | Detectable |
|---------|------|------------|
| `@Entity()` | Decorator → class as DB entity | ✅ |
| `@OneToMany`/`@ManyToOne`/`@OneToOne`/`@ManyToMany` | Decorator → related entity class | ✅ |
| `@JoinColumn`/`@JoinTable` | FK relationship config | ✅ |
| Repository injection | `@InjectRepository(User)` → entity class | ✅ |
| Prisma service | `this.prisma.user.findMany()` → Prisma model | ⚠️ |

## 7 Testing

| Pattern | Edge | Detectable |
|---------|------|------------|
| `Test.createTestingModule` | `providers`/`controllers` array → classes | ✅ |
| `overrideProvider` | Token → mock/stub class | ✅ |

## 8 Other

| Pattern | Edge | Detectable |
|---------|------|------------|
| `@Cron('expression')` | Decorator → scheduled method | ✅ |
| `@Interval(ms)` / `@Timeout(ms)` | Decorator → scheduled method | ✅ |
| Swagger `@ApiProperty` | Decorator → documentation metadata | ✅ |
| `ConfigService.get('KEY')` | String → env/config value | ⚠️ |
| `@Roles('admin')` | Custom decorator → guard reads metadata | ✅ |
| Serialization `@Exclude`/`@Expose` | Decorator → serialization behavior | ✅ |
