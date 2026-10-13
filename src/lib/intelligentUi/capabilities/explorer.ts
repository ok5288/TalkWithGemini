import {
  explorerSchema,
  initialExplorer,
  normalizeExplorer,
  deriveExplorer,
} from "../explorer";
export const explorerCapability = {
  schema: explorerSchema,
  initial: initialExplorer,
  normalize: normalizeExplorer,
  derive: deriveExplorer,
  prompt:
    'explorer: props {dataset:{kind:"inline",data:{id,version,columns:[{id,label,type:"text"|"number"|"boolean"|"date",unit?:{kind:"scalar"|"currency"|"percent"|"quantity",code?,precision?}}],rows:[{id,values:{columnId:valueOrNull}}]}} or dataset:{kind:"context",alias,version}, provenance:"user"|"source"|"example",parameters:[{id,label,value,min?,max?,step?,unit?}],nodes:[{id,label,stage:"row"|"aggregate"|"scalar",operation,inputs:[{field}|{parameter}|{node}|{constant,unit?}],collection?:"filtered"|"selected",unit?}],filters?:[{field,operator:"lte"|"gte",parameter}],chart?:{type:"bar"|"line"|"scatter",x,y},metrics?:[nodeId]}. At most 1000 rows,20 columns,16 ordered DAG nodes. Row arithmetic add/subtract/multiply/divide (2 inputs),scale(3); aggregate count(0),sum/min/max/average(1),weighted(2); scalar arithmetic or split(2). Monetary units require currency code and precision; arithmetic preserves declared units. Aggregates never feed row calculations. Context aliases must come from host. For ordinary single-chart exploration use version:1. For combined layouts only use version:2: replace top-level chart/metrics with sections:[{kind:"parameters"},{kind:"metrics",nodes:[nodeId]},{kind:"chart",id,title,type:"bar"|"line"|"scatter",x,y},{kind:"table"},{kind:"notices"}]. At most 8 ordered sections and 4 uniquely identified charts. Parameters/metrics/table/notices may each occur once; table is required, parameters is required when parameters exist. Metrics reference aggregate/scalar nodes; chart axes reference columns/row nodes, y and scatter x must be numeric. Notices show existing calculation statuses. All properties are strict; no nested layouts or arbitrary expressions. Missing numeric cells are null, not zero. Use explorer only when table/chart/calculations need linkage.',
};
