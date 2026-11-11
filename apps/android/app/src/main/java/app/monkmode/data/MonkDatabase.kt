package app.monkmode.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

/**
 * SQLite database using the SQL migrations shared with the desktop app
 * (packages/database/migrations, copied into assets/migrations at build time).
 * user_version tracks applied migrations exactly as on desktop.
 */
class MonkDatabase(private val context: Context) : SQLiteOpenHelper(context, NAME, null, migrations(context).size) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) = apply(db, 0)

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = apply(db, oldVersion)

    private fun apply(db: SQLiteDatabase, from: Int) {
        migrations(context).drop(from).forEach { file ->
            val sql = context.assets.open("migrations/$file").bufferedReader().use { it.readText() }
            splitStatements(sql).forEach(db::execSQL)
        }
    }

    companion object {
        const val NAME = "monk-mode.sqlite"

        fun migrations(context: Context): List<String> =
            context.assets.list("migrations")?.filter { it.endsWith(".sql") }?.sorted().orEmpty()

        /** Splits a migration file into statements (comments removed; no semicolons inside literals in our schema). */
        fun splitStatements(sql: String): List<String> =
            sql.lines().filterNot { it.trimStart().startsWith("--") }.joinToString("\n")
                .split(';').map { it.trim() }.filter { it.isNotEmpty() }

        fun newId(): String = UUID.randomUUID().toString()
    }
}

// ---------- Small cursor / values helpers ----------

fun Cursor.str(col: String): String = getString(getColumnIndexOrThrow(col)) ?: ""
fun Cursor.strOrNull(col: String): String? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getString(it) }
fun Cursor.long(col: String): Long = getLong(getColumnIndexOrThrow(col))
fun Cursor.longOrNull(col: String): Long? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getLong(it) }
fun Cursor.int(col: String): Int = getInt(getColumnIndexOrThrow(col))
fun Cursor.bool(col: String): Boolean = getInt(getColumnIndexOrThrow(col)) == 1

inline fun <T> SQLiteDatabase.rows(sql: String, vararg args: Any?, map: (Cursor) -> T): List<T> =
    rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
        val out = ArrayList<T>(c.count)
        while (c.moveToNext()) out.add(map(c))
        out
    }

inline fun <T> SQLiteDatabase.tx(block: SQLiteDatabase.() -> T): T {
    beginTransaction()
    try {
        val r = block()
        setTransactionSuccessful()
        return r
    } finally {
        endTransaction()
    }
}

fun values(vararg pairs: Pair<String, Any?>): ContentValues = ContentValues().apply {
    for ((k, v) in pairs) when (v) {
        null -> putNull(k)
        is String -> put(k, v)
        is Int -> put(k, v)
        is Long -> put(k, v)
        is Boolean -> put(k, if (v) 1 else 0)
        is Double -> put(k, v)
        else -> put(k, v.toString())
    }
}
