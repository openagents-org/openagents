import { CSSProperties, Fragment, useId } from 'react';
import { Button } from '@/components/ui/button';
import { useDataGrid } from '@/components/ui/data-grid';
import {
  DataGridTableBase,
  DataGridTableBody,
  DataGridTableBodyRow,
  DataGridTableBodyRowCell,
  DataGridTableBodyRowExpandded,
  DataGridTableBodyRowSkeleton,
  DataGridTableBodyRowSkeletonCell,
  DataGridTableEmpty,
  DataGridTableHead,
  DataGridTableHeadRow,
  DataGridTableHeadRowCell,
  DataGridTableHeadRowCellResize,
  DataGridTableRowSpacer,
} from '@/components/ui/data-grid-table';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Cell, flexRender, Header, HeaderGroup, Row } from '@tanstack/react-table';
import { GripVertical } from 'lucide-react';

function DataGridTableDndHeader<TData>({ header }: { header: Header<TData, unknown> }) {
  const { props } = useDataGrid();
  const { column } = header;

  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: header.column.id,
  });

  const style: CSSProperties = {
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    transform: CSS.Translate.toString(transform),
    transition,
    whiteSpace: 'nowrap',
    width: header.column.getSize(),
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <DataGridTableHeadRowCell header={header} dndStyle={style} dndRef={setNodeRef}>
      <div className="flex items-center justify-start gap-0.5">
        <Button
          mode="icon"
          size="sm"
          variant="dim"
          className="-ms-2 size-6"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="opacity-50" aria-hidden="true" />
        </Button>
        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
        {props.tableLayout?.columnsResizable && column.getCanResize() && (
          <DataGridTableHeadRowCellResize header={header} />
        )}
      </div>
    </DataGridTableHeadRowCell>
  );
}

function DataGridTableDndCell<TData>({ cell }: { cell: Cell<TData, unknown> }) {
  const { isDragging, setNodeRef, transform, transition } = useSortable({
    id: cell.column.id,
  });

  const style: CSSProperties = {
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    transform: CSS.Translate.toString(transform),
    transition,
    width: cell.column.getSize(),
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <DataGridTableBodyRowCell cell={cell} dndStyle={style} dndRef={setNodeRef}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </DataGridTableBodyRowCell>
  );
}

function DataGridTableDnd<TData>({ handleDragEnd }: { handleDragEnd: (event: DragEndEvent) => void }) {
  const { table, isLoading, props } = useDataGrid();
  const pagination = table.getState().pagination;

  const sensors = useSensors(useSensor(MouseSensor, {}), useSensor(TouchSensor, {}), useSensor(KeyboardSensor, {}));

  return (
    <DndContext
      id={useId()}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <div className="relative">
        <DataGridTableBase>
          <DataGridTableHead>
            {table.getHeaderGroups().map((headerGroup: HeaderGroup<TData>, index) => {
              console.log('table.getState().columnOrder:', table.getState().columnOrder);

              return (
                <DataGridTableHeadRow headerGroup={headerGroup} key={index}>
                  <SortableContext items={table.getState().columnOrder} strategy={horizontalListSortingStrategy}>
                    {headerGroup.headers.map((header, index) => (
                      <DataGridTableDndHeader header={header} key={index} />
                    ))}
                  </SortableContext>
                </DataGridTableHeadRow>
              );
            })}
          </DataGridTableHead>

          {(props.tableLayout?.stripped || !props.tableLayout?.rowBorder) && <DataGridTableRowSpacer />}

          <DataGridTableBody>
            {props.loadingMode === 'skeleton' && isLoading && pagination?.pageSize ? (
              Array.from({ length: pagination.pageSize }).map((_, rowIndex) => (
                <DataGridTableBodyRowSkeleton key={rowIndex}>
                  {table.getVisibleFlatColumns().map((column, colIndex) => {
                    return (
                      <DataGridTableBodyRowSkeletonCell column={column} key={colIndex}>
                        {column.columnDef.meta?.skeleton}
                      </DataGridTableBodyRowSkeletonCell>
                    );
                  })}
                </DataGridTableBodyRowSkeleton>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row: Row<TData>, index) => {
                return (
                  <Fragment key={row.id}>
                    <DataGridTableBodyRow row={row} key={index}>
                      {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
                        return (
                          <SortableContext
                            key={cell.id}
                            items={table.getState().columnOrder}
                            strategy={horizontalListSortingStrategy}
                          >
                            <DataGridTableDndCell cell={cell} />
                          </SortableContext>
                        );
                      })}
                    </DataGridTableBodyRow>
                    {row.getIsExpanded() && <DataGridTableBodyRowExpandded row={row} />}
                  </Fragment>
                );
              })
            ) : (
              <DataGridTableEmpty />
            )}
          </DataGridTableBody>
        </DataGridTableBase>
      </div>
    </DndContext>
  );
}

export { DataGridTableDnd };
