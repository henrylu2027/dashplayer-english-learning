import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import {cn} from "@/fronted/lib/utils";
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { useTranslation } from 'react-i18next';

const TitleBarLayout = () => {
    const { t } = useTranslation('common');
    return (
        <div
            className={cn(
                'w-full h-screen bg-stone-200 flex flex-col font-face-arc overflow-hidden select-none',
                'dark:bg-neutral-700'
            )}
        >
            {/* 顶边留一条整宽拖动带：无边框窗口没有系统标题栏，
                不给这块区域就无法拖动窗口（上下左右都动不了） */}
            <TitleBar className="top-0 left-0 w-full h-2.5 z-50" />
            <Suspense fallback={<div>{t('loading')}</div>}>
                <div className={cn('flex-1 h-0 w-full')}>
                    <Outlet />
                </div>
            </Suspense>
        </div>
    );
};
export default TitleBarLayout;
