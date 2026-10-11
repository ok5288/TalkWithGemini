import { MERMAID_PROMPT_EXAMPLE } from "@/lib/chat/diagramPrompt";

export const mermaidQualitySamples = {
  flowchart: {
    diagramType: "flowchart-v2",
    title: "Request validation",
    source: MERMAID_PROMPT_EXAMPLE,
  },
  sequence: {
    diagramType: "sequence",
    title: "缓存查询与重试",
    source: `sequenceDiagram
  accTitle: 缓存查询与重试
  accDescr: 缓存命中时直接返回；未命中时查询数据库，并保留重试过程。
  autonumber
  participant C as 客户端
  participant S as 服务端
  participant D as 数据库
  C->>S: 请求数据
  activate S
  alt 缓存命中
    S-->>C: 返回缓存
  else 缓存未命中
    loop 最多两次查询
      S->>D: 查询
      D-->>S: 查询结果
    end
    Note over S,D: 保留失败信息供调用方判断
    S-->>C: 返回结果
  end
  deactivate S`,
  },
  state: {
    diagramType: "stateDiagram",
    title: "任务生命周期",
    source: `stateDiagram-v2
  accTitle: 任务生命周期
  accDescr: 任务可完成、失败后重试或被取消，三种结果保持独立。
  state "等待执行" as Pending
  state "执行中" as Running
  state "已失败" as Failed
  state "已完成" as Done
  state "已取消" as Cancelled
  [*] --> Pending
  state 执行阶段 {
    Pending --> Running: 开始
    Running --> Failed: 失败
    Failed --> Pending: 重试
  }
  Running --> Done: 完成
  Running --> Cancelled: 取消
  Done --> [*]
  Cancelled --> [*]`,
  },
  er: {
    diagramType: "er",
    title: "用户与订单",
    source: `erDiagram
  accTitle: 用户与订单
  accDescr: 每个订单属于一名用户；用户可有零个或多个订单。
  USER ||--o{ ORDER : places
  USER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    string user_id FK
    string status
  }`,
  },
  architecture: {
    diagramType: "flowchart-v2",
    title: "请求路径与分组",
    source: `flowchart LR
  accTitle: 请求路径与分组
  accDescr: 网页与移动端经过网关访问服务；服务读取缓存，未命中时查询数据库。
  subgraph clients["客户端"]
    web["网页（v2）"]
    mobile["移动端 / App"]
  end
  subgraph core["核心服务"]
    gateway["API 网关"] --> service["解析 JSON（v2）"]
    service --> cache[("缓存")]
    service -->|未命中| db[("数据库")]
  end
  web --> gateway
  mobile --> gateway
  service -.->|失败后重试| gateway`,
  },
} as const;
