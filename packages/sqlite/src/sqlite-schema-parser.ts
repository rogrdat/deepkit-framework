/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { DatabaseModel, ForeignKey, Table, parseType, SchemaParser, Column } from '@deepkit/sql';
import { arrayRemoveItem } from '@deepkit/core';
import { isJsonLike } from './sqlite-platform';

export class SQLiteSchemaParser extends SchemaParser {
    async parse(database: DatabaseModel, limitTableNames?: string[]) {
        await this.parseTables(database, limitTableNames);

        for (const table of database.tables) {
            await this.addColumns(table);
        }
        for (const table of database.tables) {
            await this.addIndexes(database, table);
            await this.addForeignKeys(database, table);
        }
    }

    protected async addIndexes(database: DatabaseModel, table: Table) {
        const tableName = table.getFullName(this.platform.getSchemaDelimiter());
        const rows = await this.connection.execAndReturnAll(`PRAGMA index_list(${this.platform.quoteValue(tableName)})`);

        for (const row of rows) {
            const name = row.name as string;
            let internalName = name;
            if (name.startsWith('sqlite_autoindex')) internalName = '';

            const index = table.addIndex(internalName, row.unique === 1);
            index.partial = row.partial === 1;

            const indexInfo = await this.connection.execAndReturnAll(`PRAGMA index_info('${name}')`);
            for (const indexRow of indexInfo) index.addColumn(indexRow.name);

            if (index.columns.length === 1 && table.hasPrimaryKey() && table.getPrimaryKeys()[0].name === index.columns[0].name) {
                // exclude the primary unique index, since it's autogenerated by sqlite
                arrayRemoveItem(table.indices, index);
            }
        }
    }

    protected async addForeignKeys(database: DatabaseModel, table: Table) {
        const tableName = table.getFullName(this.platform.getSchemaDelimiter());
        const rows = await this.connection.execAndReturnAll(`PRAGMA foreign_key_list(${this.platform.quoteValue(tableName)})`);

        let lastId: any = undefined;
        let fk: ForeignKey | undefined = undefined;
        for (const row of rows) {
            if (lastId !== row.id) {
                lastId = row.id;
                const foreignTable = database.getTableForFull(row.table, this.platform.getSchemaDelimiter());
                fk = table.addForeignKey('', foreignTable);
                if (row.on_update) fk.onUpdate = row.on_update;
                if (row.on_delete) fk.onDelete = row.on_delete;
            }

            if (fk) fk.addReference(row.from, row.to);
        }
    }


    protected async addColumns(table: Table) {
        const tableName = table.getFullName(this.platform.getSchemaDelimiter());
        const rows = await this.connection.execAndReturnAll(`PRAGMA table_info('${tableName}')`);

        for (const row of rows) {
            const name = row.name as string;
            const fullType = row.type as string;
            const column = table.addColumn(name);
            parseType(column, fullType);

            column.isNotNull = row.notnull === 1;
            column.isPrimaryKey = row.pk === 1;
            this.mapDefault(row.dflt_value, column);

            if (column.isPrimaryKey) {
                //check if auto-increment
                const aiRow = await this.connection.execAndReturnSingle(`
                SELECT tbl_name
                FROM sqlite_master
                WHERE
                  tbl_name = ${this.platform.quoteValue(tableName)}
                AND
                  sql LIKE '%AUTOINCREMENT%'`);

                if (aiRow && aiRow.tbl_name === tableName) column.isAutoIncrement = true;
            }
        }
    }

    protected mapDefault(dbDefault: null | string, column: Column) {
        //https://www.sqlite.org/syntaxdiagrams.html#column-constraint its an expression;
        if ('string' === typeof dbDefault) {
            try {
                //don't judge me
                column.defaultValue = eval(dbDefault);
                column.defaultValue = JSON.parse(column.defaultValue);
            } catch (error: any) {
                if (column.defaultValue === undefined) {
                    column.defaultExpression = '(' + dbDefault + ')';
                }
            }
        } else {
            column.defaultValue = dbDefault || undefined;
        }
    }

    protected async parseTables(database: DatabaseModel, limitTableNames?: string[]) {
        let filter = '';

        if (database.schemaName) {
            filter = `AND name LIKE '${database.schemaName}§%'`;
        }

        const sql = `
        SELECT name
        FROM sqlite_master
        WHERE type='table'
        ${filter}
        UNION ALL
        SELECT name
        FROM sqlite_temp_master
        WHERE type='table'
        ${filter}
        ORDER BY name;
        `;

        const rows = await this.connection.execAndReturnAll(sql);
        for (const row of rows) {
            let tableName = row.name;
            let tableSchema = '';

            if (tableName.startsWith('sqlite_')) continue;

            if (tableName.includes(this.platform.getSchemaDelimiter())) {
                [tableSchema, tableName] = tableName.split(this.platform.getSchemaDelimiter());
            }

            if (limitTableNames && !limitTableNames.includes(tableName)) continue;

            if (this.platform.getMigrationTableName() === tableName) continue;

            const table = database.addTable(tableName);
            table.schemaName = tableSchema || database.schemaName;
        }
    }
}
