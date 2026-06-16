import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import './pagination.css'

export const Pagination:FunctionComponent<{
    state:AppState;
    variant?:string;
    onPrevPage:()=>any;
    onNextPage:()=>any;
    onPageSizeChange:(ev:Event)=>any;
}> = function Pagination (props) {
    const { state, variant, onPrevPage, onNextPage, onPageSizeChange } = props
    const { itemsTotal, itemsOffset, pageSize } = state
    if (itemsTotal.value === 0) return null

    const hasPrev = itemsOffset.value > 0
    const hasNext = itemsOffset.value + pageSize.value < itemsTotal.value
    const pageStart = itemsOffset.value + 1
    const pageEnd = Math.min(
        itemsOffset.value + pageSize.value,
        itemsTotal.value
    )
    const cls = 'pagination' + (variant ? ' ' + variant : '')

    return html`
        <div class=${cls}>
            <button
                class="btn btn-small"
                onClick=${onPrevPage}
                disabled=${!hasPrev}
            >
                Previous
            </button>
            <span class="pagination-info">
                ${pageStart}--${pageEnd}
                ${' of '}${itemsTotal.value}
            </span>
            <button
                class="btn btn-small"
                onClick=${onNextPage}
                disabled=${!hasNext}
            >
                Next
            </button>

            <label class="page-size-label">
                Per page
                <select
                    class="page-size-select"
                    value=${pageSize.value}
                    onChange=${onPageSizeChange}
                >
                    <option value="20">20</option>
                    <option value="40">40</option>
                    <option value="60">60</option>
                    <option value="100">100</option>
                </select>
            </label>
        </div>
    `
}
