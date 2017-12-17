export function flatten<T>(array: (T | T[] | undefined)[]) {
    const filteredArray = array.filter(Boolean) as (T | T[])[]
    return filteredArray.reduce((flatArray: T[], el) => flatArray.concat(el), [])
}
