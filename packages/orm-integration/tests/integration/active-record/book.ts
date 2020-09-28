import {entity, PrimaryKey, Reference, t} from '@deepkit/type';
import {ActiveRecord} from '@deepkit/orm';
import {User} from '../user';
import {Tag} from './tag';
import {BookTag} from './book-tag';

@entity.name('book')
export class Book extends ActiveRecord {
    @t.primary.autoIncrement public id?: PrimaryKey<number>;

    @t.array(() => Tag).backReference({via: () => BookTag})
    tags: Reference<Tag[]> = [];

    constructor(
        @t.reference() public author: Reference<User>,
        @t public title: string,
    ) {
        super();
    }
}
