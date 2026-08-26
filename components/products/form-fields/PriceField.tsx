"use client";

import { DialogFormLabel } from "@/components/shared";
import { DIALOG_FORM_FIELD_ROSE } from "@/components/shared/dialog-form-field";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MdError } from "react-icons/md";
import { NumericFormat } from "react-number-format";
import { useFormContext, Controller } from "react-hook-form";
import { useEffect } from "react";
import { useProductStore } from "@/stores";
import type { ProductFormData } from "@/lib/validations";

function MoneyInput({
  name,
  value,
  onChange,
}: {
  name: "purchasePrice" | "price";
  value: number | string;
  onChange: (value: number | string) => void;
}) {
  return (
    <NumericFormat
      id={name}
      name={name}
      value={value}
      customInput={Input}
      thousandSeparator
      placeholder="0.00"
      className={cn("h-11", DIALOG_FORM_FIELD_ROSE)}
      decimalScale={2}
      allowNegative={false}
      onValueChange={(values) => {
        const { floatValue, value: rawValue } = values;
        onChange(
          rawValue === "" ? ("" as unknown as number) : (floatValue ?? 0),
        );
      }}
    />
  );
}

export default function Price() {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext<ProductFormData>();
  const { selectedProduct } = useProductStore();

  // ProductFormDialog already owns the reset lifecycle. This keeps the new
  // purchase-price field synchronized without requiring a second dialog state.
  useEffect(() => {
    setValue("purchasePrice", selectedProduct?.purchasePrice ?? 0, {
      shouldValidate: false,
      shouldDirty: false,
    });
  }, [selectedProduct?.id, selectedProduct?.purchasePrice, setValue]);

  return (
    <>
      <div className="flex flex-col gap-2 pt-[6px]">
        <DialogFormLabel htmlFor="purchasePrice" icon={DollarSign} required>
          Precio de compra
        </DialogFormLabel>
        <Controller
          name="purchasePrice"
          control={control}
          defaultValue={0}
          render={({ field }) => (
            <MoneyInput
              name="purchasePrice"
              value={field.value ?? 0}
              onChange={field.onChange}
            />
          )}
        />
        {errors.purchasePrice && (
          <div className="text-red-500 flex gap-1 items-center text-[13px]">
            <MdError />
            <p>{String(errors.purchasePrice.message)}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-[6px]">
        <DialogFormLabel htmlFor="price" icon={DollarSign} required>
          Precio de venta
        </DialogFormLabel>
        <Controller
          name="price"
          control={control}
          defaultValue={0}
          render={({ field }) => (
            <MoneyInput
              name="price"
              value={field.value ?? 0}
              onChange={field.onChange}
            />
          )}
        />
        {errors.price && (
          <div className="text-red-500 flex gap-1 items-center text-[13px]">
            <MdError />
            <p>{String(errors.price.message)}</p>
          </div>
        )}
      </div>
    </>
  );
}
