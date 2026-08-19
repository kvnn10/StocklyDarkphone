import { cn } from "@/lib/utils";
import { filterCommandPopoverClass, FILTER_COMMAND_INPUT_WRAPPER_CLASS } from "@/lib/ui/popover-readability-styles";
import React from "react";
import { FileText } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandList, CommandGroup, CommandInput, CommandEmpty } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { FilterCommandCheckboxItem } from "@/lib/ui/filter-command-item";
import { InvoiceStatusBadge } from "@/lib/ui/semantic-badges";
import type { InvoiceStatus } from "@/types";

type InvoiceStatusOption = { value: InvoiceStatus; label: string };
const invoiceStatuses: InvoiceStatusOption[] = [
  { value: "draft", label: "Borrador" },
  { value: "sent", label: "Enviada" },
  { value: "paid", label: "Pagada" },
  { value: "overdue", label: "Vencida" },
  { value: "cancelled", label: "Cancelada" },
];

type InvoiceStatusDropDownProps = { selectedStatuses: string[]; setSelectedStatuses: React.Dispatch<React.SetStateAction<string[]>> };
export function InvoiceStatusDropDown({ selectedStatuses, setSelectedStatuses }: InvoiceStatusDropDownProps) {
  const [open, setOpen] = React.useState(false);
  function handleToggle(value: string) { setSelectedStatuses((prev) => prev.includes(value) ? prev.filter((status) => status !== value) : [...prev, value]); }
  function clearFilters() { setSelectedStatuses([]); }
  return (
    <div className="flex items-center space-x-4 poppins">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button variant="secondary" className="h-10 rounded-[28px] border border-rose-400/30 bg-gradient-to-r from-rose-500/25 via-rose-500/15 to-rose-500/10 text-gray-700 dark:text-white"><FileText className="h-4 w-4 mr-1" />Estado</Button></PopoverTrigger>
        <PopoverContent className={cn("p-0 w-48 poppins", filterCommandPopoverClass("rose"), FILTER_COMMAND_INPUT_WRAPPER_CLASS)} side="bottom" align="center">
          <Command className="p-1 bg-transparent">
            <CommandInput placeholder="Filtrar por estado..." className="bg-transparent border-0 focus:ring-0 focus:outline-none text-gray-700 dark:text-white/80" />
            <CommandList><CommandGroup>{invoiceStatuses.map((status) => <FilterCommandCheckboxItem key={status.value} value={status.label} toggleValue={status.value} checked={selectedStatuses.includes(status.value)} onToggle={handleToggle}><InvoiceStatusBadge status={status.value} label={status.label} /></FilterCommandCheckboxItem>)}</CommandGroup></CommandList>
            <CommandEmpty className="text-gray-600 dark:text-white/80 text-sm text-center p-5">No se encontró ningún estado.</CommandEmpty>
            <div className="flex flex-col gap-2 text-[23px]"><Separator className="bg-gray-300/50 dark:bg-white/10" /><Button variant="ghost" className="text-[12px] mb-1" onClick={clearFilters}>Limpiar filtros</Button></div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
