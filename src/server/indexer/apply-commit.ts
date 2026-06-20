import { isValidRecord } from '../../shared/lexicons/validate.js'
import type { JetstreamEvent } from './types.js'

export function applyCommit (sql:SqlStorage, evt:JetstreamEvent):void {
    const c = evt.commit
    if (!c) return
    const uri = `at://${evt.did}/${c.collection}/${c.rkey}`

    if (c.operation === 'delete') {
        sql.exec('DELETE FROM items WHERE uri = ?', uri)
        return
    }

    // create / update. The firehose is untrusted input: require the
    // structural field the index needs (cid, NOT NULL) and validate the
    // record shape. Drop anything off-lexicon.
    if (typeof c.cid !== 'string' || c.cid.length === 0) return
    if (!isValidRecord(c.collection, c.record)) return

    sql.exec(
        `INSERT INTO items
           (uri, did, collection, rkey, cid, record, time_us, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           cid = excluded.cid,
           record = excluded.record,
           time_us = excluded.time_us,
           indexed_at = excluded.indexed_at`,
        uri, evt.did, c.collection, c.rkey, c.cid,
        JSON.stringify(c.record), evt.time_us, Date.now()
    )
}
