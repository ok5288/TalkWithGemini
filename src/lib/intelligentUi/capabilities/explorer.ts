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
    'explorer: props {dataset:{kind:"inline",data:{id,version,columns:[{id,label,type:"text"|"number"|"boolean"|"date",unit?:{kind:"scalar"|"currency"|"percent"|"quantity",code?,precision?}}],rows:[{id,values:{columnId:valueOrNull}}]}} or dataset:{kind:"context",alias,version}, provenance:"user"|"source"|"example",parameters:[{id,label,value,min?,max?,step?,unit?}],nodes:[{id,label,stage:"row"|"aggregate"|"scalar",operation,inputs:[{field}|{parameter}|{node}|{constant,unit?}],collection?:"filtered"|"selected",unit?}],filters?:[{field,operator:"lte"|"gte",parameter}],chart?:{type:"bar"|"line"|"scatter",x,y},metrics?:[nodeId]}. At most 1000 rows,20 columns,16 ordered DAG nodes. Row arithmetic add/subtract/multiply/divide (2 inputs),scale(3); aggregate count(0),sum/min/max/average(1),weighted(2); scalar arithmetic or split(2). Monetary units require currency code and precision; arithmetic preserves declared units. Aggregates never feed row calculations. Context aliases must come from host. No arbitrary expressions. Missing numeric cells are null, not zero. Use explorer only when table/chart/calculations need linkage.',
};
