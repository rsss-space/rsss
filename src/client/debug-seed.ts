/**
 * Seeds the DEBUG localStorage key only when no value already exists.
 * Call this on app load in dev/staging to enable default debug logging
 * without clobbering a developer's custom setting.
 */
export function seedDebugIfAbsent ():void {
    if (localStorage.getItem('DEBUG') === null) {
        localStorage.setItem('DEBUG', 'rsss,rsss:*')
    }
}
