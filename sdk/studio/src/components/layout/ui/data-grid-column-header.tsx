import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useDataGrid } from '@/components/ui/data-grid';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Column } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  Check,
  ChevronsUpDown,
  PinOff,
  Settings2,
} from 'lucide-react';

interface DataGridColumnHeaderProps<TData, TValue> extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title?: string;
  icon?: ReactNode;
  pinnable?: boolean;
  filter?: ReactNode;
  visibility?: boolean;
}

function DataGridColumnHeader<TData, TValue>({
  column,
  title = '',
  icon,
  className,
  filter,
  visibility = false,
}: DataGridColumnHeaderProps<TData, TValue>) {
  const { isLoading, table, props, recordCount } = useDataGrid();

  const moveColumn = (direction: 'left' | 'right') => {
    const currentOrder = [...table.getState().columnOrder]; // Get current column order
    const currentIndex = currentOrder.indexOf(column.id); // Get current index of the column

    if (direction === 'left' && currentIndex > 0) {
      // Move column left
      const newOrder = [...currentOrder];
      const [movedColumn] = newOrder.splice(currentIndex, 1);
      newOrder.splice(currentIndex - 1, 0, movedColumn);
      table.setColumnOrder(newOrder); // Update column order
    }

    if (direction === 'right' && currentIndex < currentOrder.length - 1) {
      // Move column right
      const newOrder = [...currentOrder];
      const [movedColumn] = newOrder.splice(currentIndex, 1);
      newOrder.splice(currentIndex + 1, 0, movedColumn);
      table.setColumnOrder(newOrder); // Update column order
    }
  };

  const canMove = (direction: 'left' | 'right'): boolean => {
    const currentOrder = table.getState().columnOrder;
    const currentIndex = currentOrder.indexOf(column.id);
    if (direction === 'left') {
      return currentIndex > 0;
    } else {
      return currentIndex < currentOrder.length - 1;
    }
  };

  const headerLabel = () => {
    return (
      <div
        className={cn(
          'text-accent-foreground font-normal inline-flex h-full items-center gap-1.5 text-[0.8125rem] leading-[calc(1.125/0.8125)] [&_svg]:size-3.5 [&_svg]:opacity-60',
          className,
        )}
      >
        {icon && icon}
        {title}
      </div>
    );
  };

  const headerButton = () => {
    return (
      <Button
        variant="ghost"
        className={cn(
          'text-secondary-foreground rounded-md font-normal -ms-2 px-2 h-7 hover:bg-secondary data-[state=open]:bg-secondary hover:text-foreground data-[state=open]:text-foreground',
          className,
        )}
        disabled={isLoading || recordCount === 0}
        onClick={() => {
          const isSorted = column.getIsSorted();
          if (isSorted === 'asc') {
            column.toggleSorting(true);
          } else if (isSorted === 'desc') {
            column.clearSorting();
          } else {
            column.toggleSorting(false);
          }
        }}
      >
        {icon && icon}
        {title}

        {column.getCanSort() &&
          (column.getIsSorted() === 'desc' ? (
            <ArrowDown className="size-[0.7rem]! mt-px" />
          ) : column.getIsSorted() === 'asc' ? (
            <ArrowUp className="size-[0.7rem]! mt-px" />
          ) : (
            <ChevronsUpDown className="size-[0.7rem]! mt-px" />
          ))}
      </Button>
    );
  };

  const headerPin = () => {
    return (
      <Button
        mode="icon"
        size="sm"
        variant="ghost"
        className="-me-1 size-7 rounded-md"
        onClick={() => column.pin(false)}
        aria-label={`Unpin ${title} column`}
        title={`Unpin ${title} column`}
      >
        <PinOff className="size-3.5! opacity-50!" aria-hidden="true" />
      </Button>
    );
  };

  const headerControls = () => {
    return (
      <div className="flex items-center h-full gap-1.5 justify-between">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{headerButton()}</DropdownMenuTrigger>
          <DropdownMenuContent className="w-40" align="start">
            {filter && <DropdownMenuLabel>{filter}</DropdownMenuLabel>}

            {filter && (column.getCanSort() || column.getCanPin() || visibility) && <DropdownMenuSeparator />}

            {column.getCanSort() && (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    if (column.getIsSorted() === 'asc') {
                      column.clearSorting();
                    } else {
                      column.toggleSorting(false);
                    }
                  }}
                  disabled={!column.getCanSort()}
                >
                  <ArrowUp className="size-3.5!" />
                  <span className="grow">Asc</span>
                  {column.getIsSorted() === 'asc' && <Check className="size-4 opacity-100! text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (column.getIsSorted() === 'desc') {
                      column.clearSorting();
                    } else {
                      column.toggleSorting(true);
                    }
                  }}
                  disabled={!column.getCanSort()}
                >
                  <ArrowDown className="size-3.5!" />
                  <span className="grow">Desc</span>
                  {column.getIsSorted() === 'desc' && <Check className="size-4 opacity-100! text-primary" />}
                </DropdownMenuItem>
              </>
            )}

            {(filter || column.getCanSort()) && (column.getCanSort() || column.getCanPin() || visibility) && (
              <DropdownMenuSeparator />
            )}

            {props.tableLayout?.columnsPinnable && column.getCanPin() && (
              <>
                <DropdownMenuItem onClick={() => column.pin(column.getIsPinned() === 'left' ? false : 'left')}>
                  <ArrowLeftToLine className="size-3.5!" aria-hidden="true" />
                  <span className="grow">Pin to left</span>
                  {column.getIsPinned() === 'left' && <Check className="size-4 opacity-100! text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => column.pin(column.getIsPinned() === 'right' ? false : 'right')}>
                  <ArrowRightToLine className="size-3.5!" aria-hidden="true" />
                  <span className="grow">Pin to right</span>
                  {column.getIsPinned() === 'right' && <Check className="size-4 opacity-100! text-primary" />}
                </DropdownMenuItem>
              </>
            )}

            {props.tableLayout?.columnsMovable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => moveColumn('left')}
                  disabled={!canMove('left') || column.getIsPinned() !== false}
                >
                  <ArrowLeft className="size-3.5!" aria-hidden="true" />
                  <span>Move to Left</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => moveColumn('right')}
                  disabled={!canMove('right') || column.getIsPinned() !== false}
                >
                  <ArrowRight className="size-3.5!" aria-hidden="true" />
                  <span>Move to Right</span>
                </DropdownMenuItem>
              </>
            )}

            {props.tableLayout?.columnsVisibility &&
              visibility &&
              (column.getCanSort() || column.getCanPin() || filter) && <DropdownMenuSeparator />}

            {props.tableLayout?.columnsVisibility && visibility && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Settings2 className="size-3.5!" />
                  <span>Columns</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {table
                      .getAllColumns()
                      .filter((col) => typeof col.accessorFn !== 'undefined' && col.getCanHide())
                      .map((col) => {
                        return (
                          <DropdownMenuCheckboxItem
                            key={col.id}
                            checked={col.getIsVisible()}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(value) => col.toggleVisibility(!!value)}
                            className="capitalize"
                          >
                            {col.columnDef.meta?.headerTitle || col.id}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {props.tableLayout?.columnsPinnable && column.getCanPin() && column.getIsPinned() && headerPin()}
      </div>
    );
  };

  if (
    props.tableLayout?.columnsMovable ||
    (props.tableLayout?.columnsVisibility && visibility) ||
    (props.tableLayout?.columnsPinnable && column.getCanPin()) ||
    filter
  ) {
    return headerControls();
  }

  if (column.getCanSort() || (props.tableLayout?.columnsResizable && column.getCanResize())) {
    return <div className="flex items-center h-full">{headerButton()}</div>;
  }

  return headerLabel();
}

export { DataGridColumnHeader, type DataGridColumnHeaderProps };
