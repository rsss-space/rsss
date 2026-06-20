export type JetstreamKind = 'commit' | 'identity' | 'account'
export type JetstreamOperation = 'create' | 'update' | 'delete'

export interface JetstreamCommit {
    rev?:string
    operation:JetstreamOperation
    collection:string
    rkey:string
    cid?:string             // absent on delete
    record?:unknown         // absent on delete; untrusted shape otherwise
}

export interface JetstreamEvent {
    did:string
    time_us:number          // microseconds since epoch
    kind:JetstreamKind
    commit?:JetstreamCommit  // present when kind === 'commit'
}
