import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { boards } from "../db/schema.js";
import type { Board, NewBoard } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { notFound, badRequest } from "../lib/errors.js";

export interface BoardColumnInput {
  id: string;
  title: string;
  color: string;
  order: number;
  wipLimit?: number;
}

export const DEFAULT_COLUMNS: BoardColumnInput[] = [
  { id: "backlog", title: "Backlog", color: "#64748b", order: 0 },
  { id: "in-progress", title: "In progress", color: "#3b82f6", order: 1 },
  { id: "review", title: "Review", color: "#f59e0b", order: 2 },
  { id: "done", title: "Done", color: "#22c55e", order: 3 },
];

export function validateColumns(columns: BoardColumnInput[]): BoardColumnInput[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw badRequest("Board must have at least one column");
  }
  const ids = new Set<string>();
  for (const col of columns) {
    if (!col.id || !col.title) throw badRequest("Each column must have id and title");
    if (ids.has(col.id)) throw badRequest(`Duplicate column id: ${col.id}`);
    ids.add(col.id);
  }
  return columns;
}

export async function getBoard(id: string): Promise<Board> {
  const rows = await db.select().from(boards).where(eq(boards.id, id)).limit(1);
  if (rows.length === 0) throw notFound("Board");
  return rows[0];
}

export async function getBoardBySlug(slug: string): Promise<Board> {
  const rows = await db.select().from(boards).where(eq(boards.slug, slug)).limit(1);
  if (rows.length === 0) throw notFound("Board");
  return rows[0];
}

export async function listBoards(): Promise<Board[]> {
  return db.select().from(boards).orderBy(boards.createdAt);
}

export interface CreateBoardInput {
  name: string;
  slug: string;
  columns?: BoardColumnInput[];
  createdBy: string;
}

export async function createBoard(input: CreateBoardInput): Promise<Board> {
  const columns = validateColumns(input.columns ?? DEFAULT_COLUMNS);
  const id = generateId();
  const timestamp = now();
  const board: NewBoard = {
    id,
    name: input.name,
    slug: input.slug,
    columns,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: input.createdBy,
  };
  await db.insert(boards).values(board);
  return board;
}

export interface UpdateBoardInput {
  name?: string;
  columns?: BoardColumnInput[];
}

export async function updateBoard(id: string, input: UpdateBoardInput): Promise<Board> {
  const board = await getBoard(id);
  const updates: Partial<NewBoard> = { updatedAt: now() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.columns !== undefined) updates.columns = validateColumns(input.columns);

  await db.update(boards).set(updates).where(eq(boards.id, id));
  return { ...board, ...updates };
}

export async function deleteBoard(id: string): Promise<void> {
  await getBoard(id);
  await db.delete(boards).where(eq(boards.id, id));
}

export function boardToJson(board: Board) {
  const columns = (board.columns as BoardColumnInput[]).map((col) => ({
    ...col,
    taskIds: [],
  }));
  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    columns,
  };
}
