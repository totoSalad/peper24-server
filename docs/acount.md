 sequenceDiagram
      actor C as 客户端
      participant AC as AuthController
      participant PC as ProfileController
      participant AS as AccountService
      participant Ports as 端口层<br/>(UserRepository / PasswordHasher<br/>SessionStore / IdGenerator / Clock)

      Note over C,Ports: ════════════════════ 注册 ════════════════════

      C->>AC: POST /register {email, password, profile}
      AC->>AC: RegisterAccountSchema.parse()
      AC->>AS: register(input)
      AS->>AS: normalizeEmail()<br/>assertProfile()
      AS->>Ports: findByEmail() → 查重
      alt 已注册
          AS-->>C: 409 EMAIL_ALREADY_REGISTERED
      end
      AS->>Ports: hash(password)
      AS->>Ports: next() → userId
      AS->>Ports: create(account)
      AS->>Ports: next() → sessionId
      AS->>Ports: create(sessionId, userId)
      AS-->>AC: { sessionId, user }
      AC->>AC: Set-Cookie
      AC-->>C: 201 { user }

      Note over C,Ports: ════════════════════ 登录 ════════════════════

      C->>AC: POST /login {email, password}
      AC->>AC: LoginSchema.parse()
      AC->>AS: login(input)
      AS->>AS: normalizeEmail()
      AS->>Ports: findByEmail()
      AS->>Ports: verify(hash, password)
      alt 不存在 / 密码错 / 已禁用
          AS-->>C: 401 INVALID_CREDENTIALS
      end
      AS->>Ports: next() → sessionId
      AS->>Ports: create(sessionId, userId)
      AS-->>AC: { sessionId, user }
      AC->>AC: Set-Cookie
      AC-->>C: 200 { user }

      Note over C,Ports: ════════════════════ 查当前用户 ════════════════════

      C->>PC: GET /me (Cookie)
      PC->>AS: getCurrentUser(sessionId)
      AS->>Ports: findUserId(sessionId)
      alt session 无效/过期
          AS-->>C: 401 UNAUTHENTICATED
      end
      AS->>Ports: findById(userId)
      alt 用户已禁用
          AS-->>C: 401 UNAUTHENTICATED
      end
      AS->>AS: toPublicAccount() 脱敏
      PC-->>C: 200 { user }

      Note over C,Ports: ════════════════════ 更新资料 ════════════════════

      C->>PC: PATCH /me/profile {displayName, englishLevel, ...}
      PC->>PC: UpdateProfileSchema.parse()
      PC->>AS: updateProfile(sessionId, profile)
      AS->>AS: assertProfile()
      AS->>AS: getCurrentUser(sessionId) → 校验身份
      AS->>Ports: updateProfile(userId, profile)
      AS->>AS: toPublicAccount()
      PC-->>C: 200 { user }

      Note over C,Ports: ════════════════════ 登出 ════════════════════

      C->>AC: POST /logout (Cookie)
      AC->>AC: readSessionId(ctx)
      AC->>AS: logout(sessionId)
      AS->>Ports: delete(sessionId)
      AC->>AC: Clear-Cookie
      AC-->>C: 204