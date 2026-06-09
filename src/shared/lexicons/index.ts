type LexiconStringFormat = 'datetime' | 'did' | 'uri'

type LexiconStringProperty = {
    readonly type:'string';
    readonly format?:LexiconStringFormat;
    readonly description?:string;
}

type LexiconRecordDefinition = {
    readonly type:'record';
    readonly key:'tid' | 'literal:any';
    readonly record:{
        readonly type:'object';
        readonly required:readonly string[];
        readonly properties:Record<string, LexiconStringProperty>;
    };
}

type LexiconDoc = {
    readonly lexicon:1;
    readonly id:string;
    readonly defs:{
        readonly main:LexiconRecordDefinition;
    };
}

type MainRecord<T extends LexiconDoc> = T['defs']['main']['record']
type RequiredField<T extends LexiconDoc> = MainRecord<T>['required'][number]
type RecordProperties<T extends LexiconDoc> = MainRecord<T>['properties']

type PropertyValue<T> = T extends { readonly type:'string' }
    ? string
    : never

export type RecordFromLexicon<T extends LexiconDoc> = {
    [K in keyof RecordProperties<T> as K extends RequiredField<T>
        ? K
        : never]:PropertyValue<RecordProperties<T>[K]>;
} & {
    [K in keyof RecordProperties<T> as K extends RequiredField<T>
        ? never
        : K]?:PropertyValue<RecordProperties<T>[K]>;
}

export const feedSubscriptionLexicon = {
    lexicon: 1,
    id: 'space.rsss.feed.subscription',
    defs: {
        main: {
            type: 'record',
            key: 'literal:any',
            record: {
                type: 'object',
                required: ['feedUrl', 'createdAt'],
                properties: {
                    feedUrl: {
                        type: 'string',
                        format: 'uri',
                        description: 'Canonical RSS or Atom feed URL.'
                    },
                    title: {
                        type: 'string',
                        description: 'Human-readable feed title.'
                    },
                    siteUrl: {
                        type: 'string',
                        format: 'uri',
                        description: 'Optional site URL associated with feed.'
                    },
                    createdAt: {
                        type: 'string',
                        format: 'datetime',
                        description: 'Timestamp when rsss published the record.'
                    }
                }
            }
        }
    }
} as const satisfies LexiconDoc

export const graphFollowLexicon = {
    lexicon: 1,
    id: 'space.rsss.graph.follow',
    defs: {
        main: {
            type: 'record',
            key: 'tid',
            record: {
                type: 'object',
                required: ['subject', 'createdAt'],
                properties: {
                    subject: {
                        type: 'string',
                        format: 'did',
                        description: 'DID of the rsss user being followed.'
                    },
                    createdAt: {
                        type: 'string',
                        format: 'datetime',
                        description: 'Timestamp when the follow was created.'
                    }
                }
            }
        }
    }
} as const satisfies LexiconDoc

export const rsssLexicons = [
    feedSubscriptionLexicon,
    graphFollowLexicon
] as const

export type FeedSubscriptionRecord =
    RecordFromLexicon<typeof feedSubscriptionLexicon>

export type GraphFollowRecord =
    RecordFromLexicon<typeof graphFollowLexicon>
