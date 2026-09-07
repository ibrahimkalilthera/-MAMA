/**
 * Custom class CRUD operations — built from the shared SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { ClassCycle, CustomClass } from '../domainTypes';

export function createClassOps(ctx: SupabaseDataCtx) {
  const { setCustomClasses, notifySuccess, notifyError } = ctx;

  const addCustomClass = async (cls: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<CustomClass | null> => {
    const code = cls.code.trim().replace(/\s+/g, ' ');
    if (!code) return null;
    const { data, error } = await supabase
      .from('custom_classes')
      .insert({
        code,
        cycle: cls.cycle,
        year: cls.year,
        section: cls.section,
        name_fr: cls.nameFr,
        name_en: cls.nameEn,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        const { data: existingRow } = await supabase
          .from('custom_classes')
          .select('*')
          .ilike('code', code)
          .maybeSingle();
        if (existingRow) {
          const existing: CustomClass = {
            id: existingRow.code,
            rowId: existingRow.id,
            cycle: existingRow.cycle as ClassCycle,
            year: existingRow.year,
            section: existingRow.section,
            nameFr: existingRow.name_fr,
            nameEn: existingRow.name_en,
            isCustom: true,
          };
          setCustomClasses(prev => prev.some(c => c.id === existing.id) ? prev : [...prev, existing]);
          return existing;
        }
      }
      notifyError('addCustomClass', error.message);
      return null;
    }
    const newClass: CustomClass = {
      id: data.code,
      rowId: data.id,
      cycle: data.cycle as ClassCycle,
      year: data.year,
      section: data.section,
      nameFr: data.name_fr,
      nameEn: data.name_en,
      isCustom: true,
    };
    setCustomClasses(prev => [...prev, newClass]);
    return newClass;
  };

  const updateCustomClass = async (rowId: string, updates: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<boolean> => {
    const code = updates.code.trim().replace(/\s+/g, ' ');
    if (!code) return false;
    const { error } = await supabase
      .from('custom_classes')
      .update({
        code,
        cycle: updates.cycle,
        year: updates.year,
        section: updates.section,
        name_fr: updates.nameFr,
        name_en: updates.nameEn,
      })
      .eq('id', rowId);
    if (error) {
      if (error.code === '23505') {
        notifyError('updateCustomClass', 'A class with this code already exists.');
        return false;
      }
      notifyError('updateCustomClass', error.message);
      return false;
    }
    setCustomClasses(prev => prev.map(c => c.rowId === rowId
      ? { ...c, id: code, cycle: updates.cycle, year: updates.year, section: updates.section, nameFr: updates.nameFr, nameEn: updates.nameEn }
      : c));
    notifySuccess('updateCustomClass');
    return true;
  };

  const deleteCustomClass = async (rowId: string): Promise<boolean> => {
    const { error } = await supabase
      .from('custom_classes')
      .delete()
      .eq('id', rowId);
    if (error) {
      notifyError('deleteCustomClass', error.message);
      return false;
    }
    setCustomClasses(prev => prev.filter(c => c.rowId !== rowId));
    notifySuccess('deleteCustomClass');
    return true;
  };

  return { addCustomClass, updateCustomClass, deleteCustomClass };
}