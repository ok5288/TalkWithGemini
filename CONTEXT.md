# Product terminology

## Research

- **Research plan / 研究计划:** The user-reviewable objective, scope, steps,
  sources, and deliverable that must be approved before research begins.
- **Starter plan / 基础计划:** A fallback research plan offered when the generated
  plan remains invalid. It requires review and approval before research begins.
- **Model knowledge / 模型已有知识:** Information available to the model without
  retrieval. It can help plan or supplement a report, but is not evidence verified
  by the current research.
- **Project knowledge / 项目知识库:** The collections or files selected for the
  conversation or workspace. A planning lookup clarifies concepts; it does not
  make the returned passages formal research evidence.
- **Research round / 研究轮次:** A bounded group of research questions investigated
  together before their findings are recorded.
- **Evidence / 论据:** Material read and recorded during approved research with
  its source and relationship to a claim. Discovery summaries and model knowledge
  are not formal evidence.
- **Claim / 主张:** An assertion supported, contradicted, or contextualized by
  evidence; its verification state is separate from report availability.
- **Report / 研究报告:** The versioned result of research, including explicit
  limitations when evidence is incomplete or generation was interrupted.
- **Evidence snapshot / 证据快照:** The report's fixed evidence and claims used for
  questions about that exact version. Its availability is independent of whether
  the report can be read or exported.

- **Image material / 图片资料:** A discovered image with its available description
  and source, used to illustrate a report. An unexamined image is not verified
  evidence for a claim.

## Conversations

- **Share snapshot / 分享快照:** A read-only publication of the selected
  conversation branch at a particular moment. Later conversation changes become
  public only after an explicit update; deleting the original conversation
  cancels its share.
- **Temporary conversation / 临时会话:** A chat whose contents are retained only
  while it is active, without saved history or persistent memory. Leaving the
  conversation discards its contents.

## Intelligent interfaces

- **Intelligent interface / 智能界面:** A local interactive explanation embedded
  in an answer, chosen for the user's task. It can contain native controls or
  HTML; ordinary interaction stays local, while an explicit AI button can send a
  normal chat request through the host SDK.
- **Interface definition / 界面定义:** The original content and behavior of one
  interface, independent of the user's subsequent inputs and results.
- **Interface instance / 界面实例:** One occurrence of a definition in a specific
  answer and conversation branch, with its own saved progress.
- **Content projection / 内容投影:** The readable content selected for a purpose
  such as model context, static reading, public sharing, or an editable draft.
  Chat continuation includes source and reported visible results; public sharing
  still requires explicit selection to include private progress.
- **Learning progress / 学习进度:** The current practice round and most recent
  results in an interface instance, not a cross-conversation learning profile.
- **Wrong-answer practice / 错题复练:** Another local round using questions whose
  most recently submitted answers were incorrect, without generating new questions.
- **Flashcard self-rating / 闪卡自评:** The user's latest assessment of a card
  after revealing its answer: known or needs more practice. It is not an exam score.

- **Linked exploration / 联动探索:** One dataset explored through coordinated
  tables, charts and calculations. A change of scenario produces a derived result,
  not a new source or piece of research evidence.
- **Source binding / 来源绑定:** A connection to an accessible, specific version
  of a material. It establishes which material is used, not whether its claims
  are true.
- **Imported replacement / 导入替换数据:** User-confirmed data used in place of
  an interface's original dataset, private until explicitly included in output.
- **Result draft / 结果草稿:** A new local document containing selected visible
  tool results, created only after the user reviews and confirms its contents.
- **MCP App view / MCP 应用视图:** An interface associated with an installed
  tool's declared resource, subject to the host's granted capabilities. It is
  distinct from a model-authored HTML explanation.
